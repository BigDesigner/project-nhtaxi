import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CancelTripRequestSchema,
  CreateTripRequestSchema,
  ErrorResponseSchema,
  TripEventResponseSchema,
  TripResponseSchema,
  UpdateTripStatusRequestSchema,
} from "@gnncab/contract";
import {
  createDb,
  customerProfilesTable,
  driverProfilesTable,
  driverTripCommissionsTable,
  paymentsTable,
  tripEventsTable,
  tripsTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { estimateFare, haversineMiles } from "../lib/fare";
import { sendPushToUser } from "../lib/fcm";
import { clientIp } from "../lib/request";
import { customerTripNotification } from "../lib/trip-notifications";
import { authenticate } from "../middlewares/auth";

const trips = new OpenAPIHono<AppBindings>();
trips.use("*", authenticate);

// Faz 3b: dispatch (find-nearest, 60s accept window, redispatch on
// reject/timeout, max 3 attempts) lives in DispatchCoordinator — one
// instance per trip, keyed by tripId via idFromName.
const VALID_TRANSITIONS: Record<string, string[]> = {
  REQUESTED: ["DRIVER_ASSIGNED", "TRIP_CANCELLED"],
  DRIVER_ASSIGNED: ["DRIVER_ACCEPTED", "DRIVER_REJECTED", "DRIVER_NO_RESPONSE"],
  DRIVER_ACCEPTED: ["DRIVER_EN_ROUTE", "TRIP_CANCELLED"],
  DRIVER_REJECTED: ["REQUESTED"],
  DRIVER_EN_ROUTE: ["DRIVER_ARRIVED", "TRIP_CANCELLED"],
  DRIVER_ARRIVED: ["TRIP_STARTED", "TRIP_CANCELLED"],
  TRIP_STARTED: ["TRIP_COMPLETED"],
  DRIVER_NO_RESPONSE: ["REQUESTED", "TIMEOUT"],
  TIMEOUT: [],
  TRIP_CANCELLED: [],
  TRIP_COMPLETED: [],
};
const DRIVER_ONLY_STATUSES = new Set([
  "DRIVER_ACCEPTED",
  "DRIVER_REJECTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
]);
const ACTIVE_TRIP_STATUSES = [
  "REQUESTED",
  "DRIVER_ASSIGNED",
  "DRIVER_ACCEPTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
];
const CUSTOMER_NON_CANCELLABLE = new Set(["TRIP_STARTED", "TRIP_COMPLETED", "TRIP_CANCELLED", "TIMEOUT"]);
const TERMINAL_STATUSES = new Set(["TRIP_COMPLETED", "TRIP_CANCELLED", "TIMEOUT"]);

function toTripResponse(t: typeof tripsTable.$inferSelect) {
  return {
    id: t.id,
    customerId: t.customerId,
    guestName: t.guestName,
    guestPhone: t.guestPhone,
    driverId: t.driverId,
    cityId: t.cityId,
    pickupLat: t.pickupLat,
    pickupLng: t.pickupLng,
    pickupAddress: t.pickupAddress,
    dropoffLat: t.dropoffLat,
    dropoffLng: t.dropoffLng,
    dropoffAddress: t.dropoffAddress,
    status: t.status,
    origin: t.origin,
    commissionPercent: t.commissionPercent,
    distanceMiles: t.distanceMiles,
    estimatedFare: t.estimatedFareCents != null ? t.estimatedFareCents / 100 : null,
    finalFare: t.finalFareCents != null ? t.finalFareCents / 100 : null,
    currency: t.currency,
    paymentMethod: t.paymentMethod,
    cancellationReason: t.cancellationReason,
    notes: t.notes,
    requestedAt: t.requestedAt.toISOString(),
    assignedAt: t.assignedAt?.toISOString() ?? null,
    startedAt: t.startedAt?.toISOString() ?? null,
    completedAt: t.completedAt?.toISOString() ?? null,
  };
}

async function assertOwnsTrip(
  db: ReturnType<typeof createDb>,
  trip: typeof tripsTable.$inferSelect,
  authUser: { userId: string; role: string }
): Promise<boolean> {
  if (authUser.role === "admin") return true;
  if (authUser.role === "customer") return trip.customerId === authUser.userId;
  if (authUser.role === "driver") {
    if (!trip.driverId) return false;
    const [dp] = await db
      .select({ id: driverProfilesTable.id })
      .from(driverProfilesTable)
      .where(eq(driverProfilesTable.userId, authUser.userId))
      .limit(1);
    return dp?.id === trip.driverId;
  }
  return false;
}

// ─── POST / — request a trip (customer only) ───────────────────────────────
const createTripRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["trips"],
  summary: "Request a new trip",
  request: { body: { required: true, content: { "application/json": { schema: CreateTripRequestSchema } } } },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: TripResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Already has an active trip", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(createTripRoute, async (c) => {
  const authUser = c.get("user")!;
  if (authUser.role !== "customer") {
    return c.json({ error: "Forbidden", message: "Only passengers can request a trip" }, 403);
  }
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [existing] = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(eq(tripsTable.customerId, authUser.userId), eq(tripsTable.status, "REQUESTED")))
    .limit(1);
  if (existing) {
    return c.json({ error: "Conflict", message: "You already have an active trip request" }, 409);
  }
  // Also cover the other active statuses.
  for (const status of ACTIVE_TRIP_STATUSES) {
    const [row] = await db
      .select({ id: tripsTable.id })
      .from(tripsTable)
      .where(and(eq(tripsTable.customerId, authUser.userId), eq(tripsTable.status, status as any)))
      .limit(1);
    if (row) return c.json({ error: "Conflict", message: "You already have an active trip" }, 409);
  }

  const straightLineMiles = haversineMiles(body.pickupLat, body.pickupLng, body.dropoffLat, body.dropoffLng);
  const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, straightLineMiles);

  const [trip] = await db
    .insert(tripsTable)
    .values({
      customerId: authUser.userId,
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      pickupAddress: body.pickupAddress,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
      dropoffAddress: body.dropoffAddress,
      paymentMethod: body.paymentMethod,
      notes: body.notes,
      distanceMiles,
      estimatedFareCents,
      currency,
      status: "REQUESTED",
    })
    .returning();
  if (!trip) throw new Error("Insert into trips returned no row");

  await db
    .insert(tripEventsTable)
    .values({ tripId: trip.id, status: "REQUESTED", actorId: authUser.userId, actorRole: "customer" });
  await db
    .insert(paymentsTable)
    .values({ tripId: trip.id, amountCents: estimatedFareCents, currency, method: body.paymentMethod, status: "PENDING" });

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: trip.id,
      action: AuditAction.TRIP_REQUESTED,
      actorId: authUser.userId,
      actorRole: "customer",
      ipAddress: clientIp(c),
    })
  );

  const doId = c.env.DISPATCH_COORDINATOR.idFromName(trip.id);
  const coordinator = c.env.DISPATCH_COORDINATOR.get(doId);
  await coordinator.fetch("http://dispatch-coordinator/dispatch", {
    method: "POST",
    body: JSON.stringify({ tripId: trip.id }),
  });

  const [finalTrip] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: trip.id,
      action:
        finalTrip!.status === "DRIVER_ASSIGNED" ? AuditAction.TRIP_DRIVER_ASSIGNED : AuditAction.TRIP_NO_DRIVER_AVAILABLE,
      metadata: { driverId: finalTrip!.driverId },
    })
  );

  return c.json(toTripResponse(finalTrip!), 201);
});

// ─── GET / — list, role-scoped ──────────────────────────────────────────────
const listTripsRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["trips"],
  summary: "List trips (own trips for passenger/driver, all for admin)",
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: { 200: { description: "Trips", content: { "application/json": { schema: z.array(TripResponseSchema) } } } },
});

trips.openapi(listTripsRoute, async (c) => {
  const authUser = c.get("user")!;
  const { limit, offset } = c.req.valid("query");
  const db = createDb(c.env.DB);

  let where;
  if (authUser.role === "customer") {
    where = eq(tripsTable.customerId, authUser.userId);
  } else if (authUser.role === "driver") {
    const [dp] = await db
      .select({ id: driverProfilesTable.id })
      .from(driverProfilesTable)
      .where(eq(driverProfilesTable.userId, authUser.userId))
      .limit(1);
    if (!dp) return c.json([], 200);
    where = eq(tripsTable.driverId, dp.id);
  }

  const rows = await db
    .select()
    .from(tripsTable)
    .where(where)
    .orderBy(desc(tripsTable.createdAt))
    .limit(limit)
    .offset(offset);
  return c.json(rows.map(toTripResponse), 200);
});

// ─── GET /{tripId} ──────────────────────────────────────────────────────────
const getTripRoute = createRoute({
  method: "get",
  path: "/{tripId}",
  tags: ["trips"],
  summary: "Get a trip",
  request: { params: z.object({ tripId: z.string().uuid() }) },
  responses: {
    200: { description: "Trip", content: { "application/json": { schema: TripResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(getTripRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You do not have access to this trip" }, 403);
  }
  return c.json(toTripResponse(trip), 200);
});

// ─── GET /{tripId}/events ───────────────────────────────────────────────────
const listEventsRoute = createRoute({
  method: "get",
  path: "/{tripId}/events",
  tags: ["trips"],
  summary: "Get a trip's status history",
  request: { params: z.object({ tripId: z.string().uuid() }) },
  responses: {
    200: { description: "Events", content: { "application/json": { schema: z.array(TripEventResponseSchema) } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(listEventsRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You do not have access to this trip" }, 403);
  }

  const events = await db.select().from(tripEventsTable).where(eq(tripEventsTable.tripId, tripId));
  return c.json(
    events.map((e) => ({
      id: e.id,
      tripId: e.tripId,
      status: e.status,
      actorId: e.actorId,
      actorRole: e.actorRole,
      createdAt: e.createdAt.toISOString(),
    })),
    200
  );
});

// ─── PUT /{tripId}/status ───────────────────────────────────────────────────
const updateStatusRoute = createRoute({
  method: "put",
  path: "/{tripId}/status",
  tags: ["trips"],
  summary: "Transition a trip's status",
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: UpdateTripStatusRequestSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Invalid transition", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(updateStatusRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const { status, dropoffLat, dropoffLng, dropoffAddress } = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);

  if (DRIVER_ONLY_STATUSES.has(status)) {
    if (authUser.role === "customer") {
      return c.json({ error: "Forbidden", message: "Customers cannot perform driver actions" }, 403);
    }
    if (authUser.role === "driver" && !(await assertOwnsTrip(db, trip, authUser))) {
      return c.json({ error: "Forbidden", message: "You are not the assigned driver for this trip" }, 403);
    }
  }

  if (!VALID_TRANSITIONS[trip.status]?.includes(status)) {
    return c.json({ error: "InvalidTransition", message: `Cannot transition from ${trip.status} to ${status}` }, 400);
  }

  const now = new Date();
  const updates: Partial<typeof tripsTable.$inferInsert> = { status: status as any, updatedAt: now };

  if (status === "TRIP_STARTED") {
    updates.startedAt = now;

    // Faz 5c — an admin-assigned trip may not have a dropoff yet (the
    // passenger tells the driver in person); the driver supplies it here.
    if (trip.dropoffLat == null) {
      if (dropoffLat == null || dropoffLng == null || !dropoffAddress) {
        return c.json({ error: "ValidationError", message: "Dropoff location is required to start this trip" }, 400);
      }
      const straightLineMiles = haversineMiles(trip.pickupLat, trip.pickupLng, dropoffLat, dropoffLng);
      const fare = await estimateFare(db, straightLineMiles);
      updates.dropoffLat = dropoffLat;
      updates.dropoffLng = dropoffLng;
      updates.dropoffAddress = dropoffAddress;
      updates.distanceMiles = fare.distanceMiles;
      updates.estimatedFareCents = fare.estimatedFareCents;
      updates.currency = fare.currency;

      // The fare (and so the payments record) couldn't be created at
      // admin-assignment time since the dropoff wasn't known yet.
      const [existingPayment] = await db
        .select({ id: paymentsTable.id })
        .from(paymentsTable)
        .where(eq(paymentsTable.tripId, trip.id))
        .limit(1);
      if (!existingPayment) {
        await db.insert(paymentsTable).values({
          tripId: trip.id,
          amountCents: fare.estimatedFareCents,
          currency: fare.currency,
          method: trip.paymentMethod,
          status: "PENDING",
        });
      }
    }
  }

  if (status === "TRIP_COMPLETED") {
    updates.completedAt = now;
    updates.finalFareCents = updates.estimatedFareCents ?? trip.estimatedFareCents;
    if (trip.driverId) {
      await db
        .update(driverProfilesTable)
        .set({ status: "AVAILABLE", totalTrips: sql`total_trips + 1`, updatedAt: now })
        .where(eq(driverProfilesTable.id, trip.driverId));
      if (trip.customerId) {
        await db.update(customerProfilesTable).set({ updatedAt: now }).where(eq(customerProfilesTable.userId, trip.customerId));
      }
      if (trip.origin === "ADMIN_ASSIGNED" && trip.commissionPercent != null && updates.finalFareCents != null) {
        const commissionCents = Math.round((updates.finalFareCents * trip.commissionPercent) / 100);
        await db.insert(driverTripCommissionsTable).values({
          driverId: trip.driverId,
          tripId: trip.id,
          fareCents: updates.finalFareCents,
          commissionPercent: trip.commissionPercent,
          commissionCents,
        });
        c.executionCtx.waitUntil(
          logAudit(db, {
            entity: "driver_trip_commission",
            entityId: trip.id,
            action: AuditAction.DRIVER_COMMISSION_CHARGED,
            metadata: { driverId: trip.driverId, fareCents: updates.finalFareCents, commissionCents },
          })
        );
      }
    }
    await db.update(paymentsTable).set({ status: "COMPLETED", updatedAt: now }).where(eq(paymentsTable.tripId, trip.id));
  }

  if (status === "DRIVER_REJECTED" && trip.driverId) {
    await db.update(driverProfilesTable).set({ status: "AVAILABLE", updatedAt: now }).where(eq(driverProfilesTable.id, trip.driverId));
  }

  const [updated] = await db.update(tripsTable).set(updates).where(eq(tripsTable.id, tripId)).returning();
  await db
    .insert(tripEventsTable)
    .values({ tripId, status, actorId: authUser.userId, actorRole: authUser.role });

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_STATUS_CHANGED,
      actorId: authUser.userId,
      actorRole: authUser.role,
      metadata: { from: trip.status, to: status },
      ipAddress: clientIp(c),
    })
  );

  // Tell the coordinator: accepted cancels its 60s Alarm; rejected makes it
  // immediately try the next nearest driver (see durable-objects/dispatch-coordinator.ts).
  if (status === "DRIVER_ACCEPTED" || status === "DRIVER_REJECTED") {
    const doId = c.env.DISPATCH_COORDINATOR.idFromName(tripId);
    const coordinator = c.env.DISPATCH_COORDINATOR.get(doId);
    const path = status === "DRIVER_ACCEPTED" ? "accepted" : "rejected";
    c.executionCtx.waitUntil(
      coordinator.fetch(`http://dispatch-coordinator/${path}`, { method: "POST", body: JSON.stringify({ tripId }) })
    );
  }

  // Faz 6 — DRIVER_ASSIGNED is sent from wherever it's actually set (dispatch
  // or admin.ts) since it's never a client-settable status here; this covers
  // the remaining customer-facing transitions (EN_ROUTE/ARRIVED/STARTED/
  // COMPLETED). ACCEPTED/REJECTED intentionally have no customer push.
  if (trip.customerId) {
    const notification = customerTripNotification(status);
    if (notification) c.executionCtx.waitUntil(sendPushToUser(db, c.env.FCM_SERVICE_ACCOUNT_KEY, trip.customerId, notification));
  }

  return c.json(toTripResponse(updated!), 200);
});

// ─── POST /{tripId}/cancel ───────────────────────────────────────────────────
const cancelTripRoute = createRoute({
  method: "post",
  path: "/{tripId}/cancel",
  tags: ["trips"],
  summary: "Cancel a trip",
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: CancelTripRequestSchema } } },
  },
  responses: {
    200: { description: "Cancelled", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Cannot cancel", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(cancelTripRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const { reason } = c.req.valid("json");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You do not have access to this trip" }, 403);
  }
  if (authUser.role === "customer" && CUSTOMER_NON_CANCELLABLE.has(trip.status)) {
    return c.json({ error: "InvalidState", message: "This trip can no longer be cancelled" }, 400);
  }
  if (TERMINAL_STATUSES.has(trip.status)) {
    return c.json({ error: "InvalidState", message: `Trip cannot be cancelled — current status is ${trip.status}` }, 400);
  }

  const now = new Date();
  const [updated] = await db
    .update(tripsTable)
    .set({ status: "TRIP_CANCELLED", cancellationReason: reason, updatedAt: now })
    .where(eq(tripsTable.id, tripId))
    .returning();

  if (trip.driverId) {
    await db.update(driverProfilesTable).set({ status: "AVAILABLE", updatedAt: now }).where(eq(driverProfilesTable.id, trip.driverId));
  }
  await db.insert(tripEventsTable).values({ tripId, status: "TRIP_CANCELLED", actorId: authUser.userId, actorRole: authUser.role, metadata: { reason } });
  await db.update(paymentsTable).set({ status: "FAILED", updatedAt: now }).where(eq(paymentsTable.tripId, tripId));

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_CANCELLED,
      actorId: authUser.userId,
      actorRole: authUser.role,
      metadata: { reason },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toTripResponse(updated!), 200);
});

export default trips;
export { toTripResponse };
