import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import {
  CompleteReferralTripRequestSchema,
  ErrorResponseSchema,
  StartReferralTripRequestSchema,
  TripResponseSchema,
} from "@gnncab/contract";
import {
  createDb,
  driverProfilesTable,
  driverTripCommissionsTable,
  paymentsTable,
  tripEventsTable,
  tripsTable,
} from "@gnncab/db";
import type { AppBindings } from "../env";
import { AuditAction, logAudit } from "../lib/audit";
import { getDriverUsageRates } from "../lib/driver-sessions";
import { estimateFare } from "../lib/fare";
import { clientIp } from "../lib/request";
import { roadDistanceMiles } from "../lib/routing";
import { recordTripPathVerification } from "../lib/path-verification";
import { sendTripCompletedEmails } from "../lib/trip-emails";
import { authenticate, requireRole } from "../middlewares/auth";
import { toTripResponse } from "./trips";

/**
 * Referral trips — the office phoned the driver directly.
 *
 * Everything else on this platform starts with a booking: an address typed
 * into the passenger app, or an admin filling in a form. This flow has
 * neither. The driver is already at the kerb with someone getting into the
 * car, and the only two facts that exist are *where they are now* and *where
 * they end up*. So those are the two things the driver records, with one tap
 * each, and the phone supplies the coordinates.
 *
 * The alternative — a "log a manual job" form at the end of the shift — was
 * considered and rejected. It would ask a tired driver to recall a route and
 * name a price, and GNN LLC's commission on the job would then rest on that
 * recollection. Capturing both ends live means the fare is computed from the
 * same routed road distance as every other trip, by the same code.
 */
const referralTrips = new OpenAPIHono<AppBindings>();
referralTrips.use("*", authenticate, requireRole("driver"));

/**
 * A driver can only be on one job at a time, whatever opened it. Checked
 * against the driver's own trips rather than their profile `status` because
 * status is also moved by dispatch and by the admin panel; the trip rows are
 * the thing that actually says "this car is occupied".
 */
const DRIVER_BUSY_STATUSES = [
  "DRIVER_ASSIGNED",
  "DRIVER_ACCEPTED",
  "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED",
  "TRIP_STARTED",
] as const;

/** A dead spot must not stop a driver starting a job. See the schema comment. */
function coordinateLabel(lat: number, lng: number): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

async function requireDriverProfile(db: ReturnType<typeof createDb>, userId: string) {
  const [dp] = await db
    .select({ id: driverProfilesTable.id, isVerified: driverProfilesTable.isVerified })
    .from(driverProfilesTable)
    .where(eq(driverProfilesTable.userId, userId))
    .limit(1);
  return dp ?? null;
}

// ─── POST / — the Referral button, pressed at pickup ───────────────────────
const startReferralRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["trips"],
  summary: "Open a referred trip at the driver's current position",
  request: {
    body: { required: true, content: { "application/json": { schema: StartReferralTripRequestSchema } } },
  },
  responses: {
    201: { description: "Trip started", content: { "application/json": { schema: TripResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    409: { description: "Already on a trip", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

referralTrips.openapi(startReferralRoute, async (c) => {
  const authUser = c.get("user")!;
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  const profile = await requireDriverProfile(db, authUser.userId);
  if (!profile) {
    return c.json({ error: "Forbidden", message: "No driver profile found for this account" }, 403);
  }
  // Every other route to a job runs through dispatch, which only offers work
  // to approved drivers. This one bypasses dispatch entirely, so without this
  // check someone whose licence and background check the office has never seen
  // could open real, billable trips — the exact thing approval exists to stop.
  // The driver app hides the button too, but a UI-only gate is not a gate.
  if (!profile.isVerified) {
    return c.json(
      { error: "Forbidden", message: "The office needs to approve your account before you can take jobs" },
      403
    );
  }

  const [busy] = await db
    .select({ id: tripsTable.id })
    .from(tripsTable)
    .where(and(eq(tripsTable.driverId, profile.id), inArray(tripsTable.status, [...DRIVER_BUSY_STATUSES])))
    .limit(1);
  if (busy) {
    return c.json({ error: "Conflict", message: "Finish your current trip before starting another" }, 409);
  }

  // Snapshotted now, not read at completion: a rate change mid-trip must not
  // alter what this job costs the driver. Same rule as the accept-screen tick.
  const { commissionPercent } = await getDriverUsageRates(db);
  const now = new Date();

  const [trip] = await db
    .insert(tripsTable)
    .values({
      driverId: profile.id,
      guestName: body.guestName ?? null,
      guestPhone: body.guestPhone ?? null,
      pickupLat: body.lat,
      pickupLng: body.lng,
      pickupAddress: body.address ?? coordinateLabel(body.lat, body.lng),
      // No dropoff yet — that is the entire point. It arrives on /complete
      // from the phone's GPS, and the fare is computed from it there.
      status: "TRIP_STARTED",
      origin: "DRIVER_REFERRAL",
      referralSource: "DRIVER_DECLARED",
      commissionPercent,
      requestedAt: now,
      assignedAt: now,
      startedAt: now,
    })
    .returning();
  if (!trip) throw new Error("Insert into trips returned no row");

  await db.batch([
    db.insert(tripEventsTable).values({
      tripId: trip.id,
      status: "TRIP_STARTED",
      actorId: authUser.userId,
      actorRole: "driver",
      metadata: { referral: true, lat: body.lat, lng: body.lng },
    }),
    db.update(driverProfilesTable).set({ status: "BUSY", updatedAt: now }).where(eq(driverProfilesTable.id, profile.id)),
  ]);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: trip.id,
      action: AuditAction.TRIP_REFERRAL_STARTED,
      actorId: authUser.userId,
      actorRole: "driver",
      metadata: { driverId: profile.id, lat: body.lat, lng: body.lng },
      ipAddress: clientIp(c),
    })
  );

  return c.json(toTripResponse(trip), 201);
});

// ─── POST /{tripId}/complete — the Dropped off button ──────────────────────
const completeReferralRoute = createRoute({
  method: "post",
  path: "/{tripId}/complete",
  tags: ["trips"],
  summary: "Close a referred trip at the driver's current position and price it",
  request: {
    params: z.object({ tripId: z.string().uuid() }),
    body: { required: true, content: { "application/json": { schema: CompleteReferralTripRequestSchema } } },
  },
  responses: {
    200: { description: "Completed", content: { "application/json": { schema: TripResponseSchema } } },
    400: { description: "Not completable", content: { "application/json": { schema: ErrorResponseSchema } } },
    403: { description: "Forbidden", content: { "application/json": { schema: ErrorResponseSchema } } },
    404: { description: "Not found", content: { "application/json": { schema: ErrorResponseSchema } } },
    503: { description: "Routing unavailable", content: { "application/json": { schema: ErrorResponseSchema } } },
  },
});

referralTrips.openapi(completeReferralRoute, async (c) => {
  const authUser = c.get("user")!;
  const { tripId } = c.req.valid("param");
  const body = c.req.valid("json");
  const db = createDb(c.env.DB);

  // Deliberately no isVerified check here, unlike the start endpoint. If the
  // office revokes a driver's approval mid-journey, the passenger is still in
  // the car — refusing to close the job would leave a trip open forever and
  // the fare uncomputed. Approval gates *taking* work, not finishing it.
  const profile = await requireDriverProfile(db, authUser.userId);
  if (!profile) {
    return c.json({ error: "Forbidden", message: "No driver profile found for this account" }, 403);
  }

  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip) return c.json({ error: "NotFound", message: "Trip not found" }, 404);
  if (trip.driverId !== profile.id) {
    return c.json({ error: "Forbidden", message: "This is not your trip" }, 403);
  }
  if (trip.origin !== "DRIVER_REFERRAL") {
    return c.json(
      { error: "InvalidState", message: "Only a referral trip is completed this way — use the trip status endpoint" },
      400
    );
  }
  if (trip.status !== "TRIP_STARTED") {
    return c.json({ error: "InvalidState", message: `Trip is ${trip.status}, not in progress` }, 400);
  }

  // Throws RoutingUnavailableError → 503 via app.ts. Deliberately fail-closed:
  // a referral trip has no earlier estimate to fall back on, so without a real
  // road distance there is no honest number to charge. Better the driver taps
  // again in a moment than the business bills a guess.
  const roadMiles = await roadDistanceMiles(
    c.env,
    { lat: trip.pickupLat, lng: trip.pickupLng },
    { lat: body.lat, lng: body.lng }
  );
  const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, roadMiles);

  const now = new Date();
  const commissionCents =
    trip.commissionPercent != null ? Math.round((estimatedFareCents * trip.commissionPercent) / 100) : null;

  const writes: BatchItem<"sqlite">[] = [
    db.insert(paymentsTable).values({
      tripId: trip.id,
      amountCents: estimatedFareCents,
      currency,
      method: trip.paymentMethod,
      status: "COMPLETED",
    }),
    db
      .update(driverProfilesTable)
      .set({ status: "AVAILABLE", totalTrips: sql`total_trips + 1`, updatedAt: now })
      .where(eq(driverProfilesTable.id, profile.id)),
  ];

  // referralSource is DRIVER_DECLARED on every trip this endpoint creates, so
  // this always fires — but it is written as a condition rather than an
  // assumption so that an admin clearing the referral (PUT /referral) is
  // honoured here too rather than silently overridden.
  if (trip.referralSource !== "NONE" && commissionCents != null && trip.commissionPercent != null) {
    writes.push(
      db.insert(driverTripCommissionsTable).values({
        driverId: profile.id,
        tripId: trip.id,
        fareCents: estimatedFareCents,
        commissionPercent: trip.commissionPercent,
        commissionCents,
      })
    );
  }

  // Same ordering rule as the status endpoint: the trip row goes last, so a
  // failure anywhere earlier leaves the trip in progress and the whole
  // completion safely retryable rather than half-applied.
  const tripUpdateIndex = writes.length;
  writes.push(
    db
      .update(tripsTable)
      .set({
        status: "TRIP_COMPLETED",
        dropoffLat: body.lat,
        dropoffLng: body.lng,
        dropoffAddress: body.address ?? coordinateLabel(body.lat, body.lng),
        distanceMiles,
        estimatedFareCents,
        finalFareCents: estimatedFareCents,
        currency,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(tripsTable.id, tripId))
      .returning()
  );
  writes.push(
    db.insert(tripEventsTable).values({
      tripId,
      status: "TRIP_COMPLETED",
      actorId: authUser.userId,
      actorRole: "driver",
      metadata: { referral: true, lat: body.lat, lng: body.lng },
    })
  );

  const results = await db.batch(writes as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  const [updated] = results[tripUpdateIndex] as (typeof tripsTable.$inferSelect)[];

  // Referral jobs are exactly the case this most needs to catch — no booking
  // behind the pickup/dropoff to cross-check against, only the driver's own
  // taps. Awaited, same as the ordinary trip-status path: pure DB work.
  await recordTripPathVerification(db, tripId);

  c.executionCtx.waitUntil(
    logAudit(db, {
      entity: "trip",
      entityId: tripId,
      action: AuditAction.TRIP_REFERRAL_COMPLETED,
      actorId: authUser.userId,
      actorRole: "driver",
      metadata: { driverId: profile.id, lat: body.lat, lng: body.lng, distanceMiles, fareCents: estimatedFareCents },
      ipAddress: clientIp(c),
    })
  );

  if (commissionCents != null) {
    c.executionCtx.waitUntil(
      logAudit(db, {
        entity: "driver_trip_commission",
        entityId: tripId,
        action: AuditAction.DRIVER_COMMISSION_CHARGED,
        metadata: { driverId: profile.id, fareCents: estimatedFareCents, commissionCents },
      })
    );
  }

  // No customerId on a referral trip — there was never a booking — so this
  // only ever reaches the office's inbox, which is exactly the record a job
  // with no passenger account behind it most needs.
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

  return c.json(toTripResponse(updated!), 200);
});

export default referralTrips;
