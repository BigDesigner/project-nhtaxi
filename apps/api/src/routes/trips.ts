import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, desc, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  BreadcrumbResponseSchema,
  CancelTripRequestSchema,
  CreateTripRequestSchema,
  ErrorResponseSchema,
  RecordBreadcrumbsRequestSchema,
  RecordBreadcrumbsResponseSchema,
  EstimateTripRequestSchema,
  EstimateTripResponseSchema,
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
  tripBreadcrumbsTable,
  tripEventsTable,
  tripsTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { MAX_SEARCH_ROUNDS } from "../lib/dispatch";
import { getDriverUsageRates } from "../lib/driver-sessions";
import { estimateFare } from "../lib/fare";
import { RoutingUnavailableError, roadDistanceMiles } from "../lib/routing";
import { sendPushToDriver, sendPushToUser } from "../lib/fcm";
import { clientIp } from "../lib/request";
import { customerTripNotification, TRIP_CANCELLED_NOTIFICATION } from "../lib/trip-notifications";
import { sendTripCompletedEmails } from "../lib/trip-emails";
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
// Cancelling is free right up to the moment a driver actually sets off:
// plans change, and a driver who has only accepted has spent nothing but a
// tap. Once they're EN_ROUTE they're burning fuel and turning down other
// work, so from there it's a phone call (the dispatch number is on screen)
// rather than a silent button — that keeps a real person in the loop instead
// of stranding the passenger behind a driver who never answers an in-app
// approval. Every cancellation is recorded either way, so patterns are
// visible to the admin via GET /api/admin/reports/trips?status=TRIP_CANCELLED.
// TIMEOUT is deliberately absent: a search that gave up is exactly the state
// a passenger most wants to close out (and re-open, see /retry).
const CUSTOMER_NON_CANCELLABLE = new Set([
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
  "TRIP_COMPLETED",
  "TRIP_CANCELLED",
]);
// Genuinely finished — nothing left to cancel. TIMEOUT stays cancellable so
// the trip can be closed rather than lingering in the passenger's list.
const TERMINAL_STATUSES = new Set(["TRIP_COMPLETED", "TRIP_CANCELLED"]);

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
    referralSource: t.referralSource,
    commissionPercent: t.commissionPercent,
    searchAttempts: t.searchAttempts,
    nextSearchAt: t.nextSearchAt?.toISOString() ?? null,
    maxSearchAttempts: MAX_SEARCH_ROUNDS,
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

  const roadMiles = await roadDistanceMiles(c.env, 
    { lat: body.pickupLat, lng: body.pickupLng },
    { lat: body.dropoffLat, lng: body.dropoffLng }
  );
  const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, roadMiles);

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
    // The passenger's map pick, when they made one. Kept in the coordinator's
    // own state rather than a trips column: it only matters for the first
    // offer, and a retried search should start clean.
    body: JSON.stringify({ tripId: trip.id, preferredDriverId: body.preferredDriverId }),
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

// ─── POST /estimate — quote a fare before booking (Faz 7, plan §4.9) ──────
// Registered before the /{tripId} routes so the literal path always wins.
// Open to any authenticated role rather than customers only: it writes
// nothing and exposes nothing secret (the fare table is public pricing), and
// admins need the same quote when hand-assigning a trip.
const estimateTripRoute = createRoute({
  method: "post",
  path: "/estimate",
  tags: ["trips"],
  summary: "Estimate distance and fare for a pickup/dropoff pair, without creating a trip",
  request: { body: { required: true, content: { "application/json": { schema: EstimateTripRequestSchema } } } },
  responses: {
    200: { description: "Estimate", content: { "application/json": { schema: EstimateTripResponseSchema } } },
  },
});

trips.openapi(estimateTripRoute, async (c) => {
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const roadMiles = await roadDistanceMiles(c.env, 
    { lat: body.pickupLat, lng: body.pickupLng },
    { lat: body.dropoffLat, lng: body.dropoffLng }
  );
  const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, roadMiles);

  return c.json({ distanceMiles, estimatedFare: estimatedFareCents / 100, currency }, 200);
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
  const { status, dropoffLat, dropoffLng, dropoffAddress, gnnReferred } = c.req.valid("json");
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

  // The driver ticked "GNN LLC referred this job" on the accept screen.
  //
  // Deliberately one-way: it can only turn a referral on. A driver clearing
  // one the office already set would be opting themselves out of commission,
  // which is exactly what the office needs to be able to rely on. The rate is
  // snapshotted here so a later change to the global percentage cannot
  // retroactively alter what the driver was shown before they accepted.
  if (status === "DRIVER_ACCEPTED" && gnnReferred === true && trip.referralSource === "NONE") {
    const { commissionPercent } = await getDriverUsageRates(db);
    updates.referralSource = "DRIVER_DECLARED";
    updates.commissionPercent = commissionPercent;
  }

  // Every mutation this transition performs is collected here and executed
  // as ONE D1 batch (a single implicit transaction) at the end. Running them
  // as sequential awaits risked a partially-applied transition if the isolate
  // died mid-way — most damagingly, a commission row could be inserted while
  // the trip stayed TRIP_STARTED, letting a retry insert a *second* one and
  // double-charge the driver. D1 has no interactive transactions, so batch()
  // is the atomicity primitive here (drizzle's .transaction() emits
  // BEGIN/COMMIT as separate round trips, which D1 does not honour).
  const writes: BatchItem<"sqlite">[] = [];

  if (status === "TRIP_STARTED") {
    updates.startedAt = now;

    // Faz 5c — an admin-assigned trip may not have a dropoff yet (the
    // passenger tells the driver in person); the driver supplies it here.
    if (trip.dropoffLat == null) {
      if (dropoffLat == null || dropoffLng == null || !dropoffAddress) {
        return c.json({ error: "ValidationError", message: "Dropoff location is required to start this trip" }, 400);
      }
      const roadMiles = await roadDistanceMiles(c.env,
        { lat: trip.pickupLat, lng: trip.pickupLng },
        { lat: dropoffLat, lng: dropoffLng }
      );
      const fare = await estimateFare(db, roadMiles);
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
        writes.push(
          db.insert(paymentsTable).values({
            tripId: trip.id,
            amountCents: fare.estimatedFareCents,
            currency: fare.currency,
            method: trip.paymentMethod,
            status: "PENDING",
          })
        );
      }
    }
  }

  // Recorded here, logged only after the batch actually commits.
  let chargedCommissionCents: number | null = null;

  if (status === "TRIP_COMPLETED") {
    updates.completedAt = now;
    updates.finalFareCents = updates.estimatedFareCents ?? trip.estimatedFareCents;
    if (trip.driverId) {
      writes.push(
        db
          .update(driverProfilesTable)
          .set({ status: "AVAILABLE", totalTrips: sql`total_trips + 1`, updatedAt: now })
          .where(eq(driverProfilesTable.id, trip.driverId))
      );
      if (trip.customerId) {
        writes.push(db.update(customerProfilesTable).set({ updatedAt: now }).where(eq(customerProfilesTable.userId, trip.customerId)));
      }
      // Commission follows referralSource, not origin. Drivers pay rent for
      // time on the app and ordinary dispatch work is what that rent buys —
      // only jobs GNN LLC actually referred owe a cut, and a referral can
      // reach a driver by several routes that all look like different origins.
      if (trip.referralSource !== "NONE" && trip.commissionPercent != null && updates.finalFareCents != null) {
        chargedCommissionCents = Math.round((updates.finalFareCents * trip.commissionPercent) / 100);
        writes.push(
          db.insert(driverTripCommissionsTable).values({
            driverId: trip.driverId,
            tripId: trip.id,
            fareCents: updates.finalFareCents,
            commissionPercent: trip.commissionPercent,
            commissionCents: chargedCommissionCents,
          })
        );
      }
    }
    writes.push(db.update(paymentsTable).set({ status: "COMPLETED", updatedAt: now }).where(eq(paymentsTable.tripId, trip.id)));
  }

  if (status === "DRIVER_REJECTED" && trip.driverId) {
    writes.push(db.update(driverProfilesTable).set({ status: "AVAILABLE", updatedAt: now }).where(eq(driverProfilesTable.id, trip.driverId)));
  }

  // The trip row itself goes last so that if any earlier statement in the
  // batch fails, the trip keeps its old status and the whole transition can
  // be safely retried.
  const tripUpdateIndex = writes.length;
  writes.push(db.update(tripsTable).set(updates).where(eq(tripsTable.id, tripId)).returning());
  writes.push(db.insert(tripEventsTable).values({ tripId, status, actorId: authUser.userId, actorRole: authUser.role }));

  // `writes` is always non-empty (the two pushes above) — the cast just
  // satisfies batch()'s non-empty-tuple signature, which a dynamically
  // built array can't express.
  const results = await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  const [updated] = results[tripUpdateIndex] as (typeof tripsTable.$inferSelect)[];

  if (chargedCommissionCents != null && trip.driverId) {
    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "driver_trip_commission",
        entityId: trip.id,
        action: AuditAction.DRIVER_COMMISSION_CHARGED,
        metadata: { driverId: trip.driverId, fareCents: updates.finalFareCents, commissionCents: chargedCommissionCents },
      })
    );
  }

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

  // Trip detail, by email, to whoever was in the car and to the office —
  // best-effort, same as the push above.
  if (status === "TRIP_COMPLETED") {
    c.executionCtx.waitUntil(
      sendTripCompletedEmails(db, c.env.BREVO_API_KEY, {
        id: updated!.id,
        pickupAddress: updated!.pickupAddress,
        dropoffAddress: updated!.dropoffAddress,
        distanceMiles: updated!.distanceMiles,
        finalFareCents: updated!.finalFareCents,
        currency: updated!.currency,
        driverId: updated!.driverId,
        customerId: updated!.customerId,
        guestName: updated!.guestName,
      })
    );
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
    return c.json(
      {
        error: "InvalidState",
        message: "Your driver is already on the way — please call dispatch to cancel.",
      },
      400
    );
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

  // Stop the coordinator's search loop — otherwise its Alarm keeps sweeping
  // for a driver for a trip the passenger has already called off.
  const cancelDoId = c.env.DISPATCH_COORDINATOR.idFromName(tripId);
  c.executionCtx.waitUntil(
    c.env.DISPATCH_COORDINATOR.get(cancelDoId)
      .fetch("http://dispatch-coordinator/cancelled", { method: "POST", body: JSON.stringify({ tripId }) })
  );

  // A driver who was already assigned needs to know immediately — otherwise
  // they keep heading to a pickup that no longer exists.
  if (trip.driverId && authUser.role !== "driver") {
    c.executionCtx.waitUntil(
      sendPushToDriver(db, c.env.FCM_SERVICE_ACCOUNT_KEY, trip.driverId, TRIP_CANCELLED_NOTIFICATION)
    );
  }

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

// ─── POST /{tripId}/retry — search again after the search gave up ─────────
// The coordinator stops after MAX_SEARCH_ROUNDS so a passenger who walked
// away isn't searched for forever. This is how they opt back in.
const retryTripRoute = createRoute({
  method: "post",
  path: "/{tripId}/retry",
  tags: ["trips"],
  summary: "Restart the driver search for a trip that timed out",
  request: { params: z.object({ tripId: z.string().uuid() }) },
  responses: {
    200: { description: "Searching again", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Not in a retryable state", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(retryTripRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You do not have access to this trip" }, 403);
  }
  if (trip.status !== "TIMEOUT") {
    return c.json({ error: "InvalidState", message: `Only a timed-out trip can be retried (this one is ${trip.status})` }, 400);
  }

  const now = new Date();
  await db
    .update(tripsTable)
    .set({ status: "REQUESTED", searchAttempts: 0, nextSearchAt: null, updatedAt: now })
    .where(eq(tripsTable.id, tripId));
  await db
    .insert(tripEventsTable)
    .values({ tripId, status: "REQUESTED", actorId: authUser.userId, actorRole: authUser.role, metadata: { retried: true } });

  const doId = c.env.DISPATCH_COORDINATOR.idFromName(tripId);
  await c.env.DISPATCH_COORDINATOR.get(doId)
    .fetch("http://dispatch-coordinator/restart", { method: "POST", body: JSON.stringify({ tripId }) });

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_SEARCH_RESTARTED,
      actorId: authUser.userId,
      actorRole: authUser.role,
      ipAddress: clientIp(c),
    })
  );

  const [updated] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  return c.json(toTripResponse(updated!), 200);
});

// ─── POST /{tripId}/breadcrumbs — where the car actually went ─────────────
// Written by the driver's app every ~30s while a passenger is aboard.
//
// This is evidence, not billing. The fare is priced from a routing engine
// asked what the journey *should* cost, and that stays true no matter what
// arrives here: summing raw GPS would let jitter and a wandering route both
// inflate the charge, and would make the price depend on the quality of a
// phone's signal. What breadcrumbs answer is the question routing cannot —
// where was this car, and when — which is what matters when a passenger
// disputes a trip or the office needs to know why a job took an hour.
const recordBreadcrumbsRoute = createRoute({
  method: "post",
  path: "/{tripId}/breadcrumbs",
  tags: ["trips"],
  summary: "Record the driver's positions during a trip",
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: RecordBreadcrumbsRequestSchema } } },
  },
  responses: {
    201: { description: "Recorded", content: { "application/json": { schema: RecordBreadcrumbsResponseSchema } } },
    400: { description: "Trip not in progress", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(recordBreadcrumbsRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const { points } = c.req.valid("json");
  const db = createDb(c.env.DB);

  if (authUser.role !== "driver") {
    return c.json({ error: "Forbidden", message: "Only the assigned driver records a trip's path" }, 403);
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You are not the assigned driver for this trip" }, 403);
  }
  // A finished trip's path is a record, so it stops accepting new points —
  // otherwise a phone uploading a stale backlog hours later could append to
  // the very trip the office is looking at to settle a dispute. TERMINAL is
  // the line rather than "not TRIP_STARTED": a backlog that arrives a few
  // seconds after a pickup still belongs to this trip.
  if (TERMINAL_STATUSES.has(trip.status)) {
    return c.json({ error: "InvalidState", message: `Trip is ${trip.status} — its path is closed` }, 400);
  }

  await db.insert(tripBreadcrumbsTable).values(
    points.map((p) => ({
      tripId,
      lat: p.lat,
      lng: p.lng,
      recordedAt: new Date(p.recordedAt),
    }))
  );

  return c.json({ recorded: points.length }, 201);
});

// ─── GET /{tripId}/breadcrumbs ─────────────────────────────────────────────
// Same access rule as the trip itself: the admin reviewing a complaint, the
// driver who drove it, and the passenger who rode it. Ordered by when the
// device recorded each point, not when the server received it, so a backlog
// uploaded after a dead spot still draws the route in the order it was driven.
const listBreadcrumbsRoute = createRoute({
  method: "get",
  path: "/{tripId}/breadcrumbs",
  tags: ["trips"],
  summary: "Get the path a trip actually took",
  request: { params: z.object({ tripId: z.string().uuid() }) },
  responses: {
    200: { description: "Path", content: { "application/json": { schema: z.array(BreadcrumbResponseSchema) } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

trips.openapi(listBreadcrumbsRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const db = createDb(c.env.DB);

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (!(await assertOwnsTrip(db, trip, authUser))) {
    return c.json({ error: "Forbidden", message: "You do not have access to this trip" }, 403);
  }

  const rows = await db
    .select()
    .from(tripBreadcrumbsTable)
    .where(eq(tripBreadcrumbsTable.tripId, tripId))
    .orderBy(tripBreadcrumbsTable.recordedAt);

  return c.json(
    rows.map((r) => ({ id: r.id, lat: r.lat, lng: r.lng, recordedAt: r.recordedAt.toISOString() })),
    200
  );
});

export default trips;
export { toTripResponse };
