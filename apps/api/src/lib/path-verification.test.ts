import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, tripBreadcrumbsTable, tripsTable, usersTable, customerProfilesTable, driverProfilesTable } from "@gnncab/db";
import { PATH_TOLERANCE_MILES, recordTripPathVerification, verifyTripPath } from "./path-verification";

const PICKUP = { lat: 44.0537, lng: -71.1281 };
const DROPOFF = { lat: 44.09, lng: -71.18 };

/** Roughly this many miles of latitude per degree — enough to place a point
 * comfortably inside or outside the 0.5 mi tolerance without doing real
 * geodesic math in the test itself. */
const DEGREES_PER_MILE = 1 / 69;

async function makeTrip(db: ReturnType<typeof createDb>, overrides: Partial<typeof tripsTable.$inferInsert> = {}) {
  const suffix = crypto.randomUUID();
  const [customer] = await db
    .insert(usersTable)
    .values({ email: `pat-${suffix}@example.com`, passwordHash: "x", firstName: "Pat", lastName: "P", role: "customer" })
    .returning();
  await db.insert(customerProfilesTable).values({ userId: customer!.id });

  const [driverUser] = await db
    .insert(usersTable)
    .values({ email: `dan-${suffix}@example.com`, passwordHash: "x", firstName: "Dan", lastName: "D", role: "driver" })
    .returning();
  const [driver] = await db
    .insert(driverProfilesTable)
    .values({ userId: driverUser!.id, status: "AVAILABLE", isVerified: true })
    .returning();

  const [trip] = await db
    .insert(tripsTable)
    .values({
      customerId: customer!.id,
      driverId: driver!.id,
      pickupLat: PICKUP.lat,
      pickupLng: PICKUP.lng,
      pickupAddress: "Main St",
      dropoffLat: DROPOFF.lat,
      dropoffLng: DROPOFF.lng,
      dropoffAddress: "Mountain Rd",
      status: "TRIP_COMPLETED",
      ...overrides,
    })
    .returning();
  return trip!;
}

async function addBreadcrumb(db: ReturnType<typeof createDb>, tripId: string, lat: number, lng: number, at: string) {
  await db.insert(tripBreadcrumbsTable).values({ tripId, lat, lng, recordedAt: new Date(at) });
}

describe("verifyTripPath", () => {
  it("is NOT_CHECKED when the trip has no breadcrumbs at all", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    const result = await verifyTripPath(db, trip.id);
    expect(result).toEqual({ status: "NOT_CHECKED", deviationMiles: null });
  });

  it("is NOT_CHECKED when the trip never got a dropoff recorded", async () => {
    // Defensive: a completed trip should always have one, but a check that
    // can't compute a real distance must not silently pretend it matched.
    const db = createDb(env.DB);
    const trip = await makeTrip(db, { dropoffLat: null, dropoffLng: null });
    await addBreadcrumb(db, trip.id, PICKUP.lat, PICKUP.lng, "2026-07-20T14:00:00.000Z");

    const result = await verifyTripPath(db, trip.id);
    expect(result.status).toBe("NOT_CHECKED");
  });

  it("is MATCHED when the first and last breadcrumbs land close to pickup and dropoff", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    // Well inside tolerance — a few hundred feet, not a few blocks.
    await addBreadcrumb(db, trip.id, PICKUP.lat + 0.05 * DEGREES_PER_MILE, PICKUP.lng, "2026-07-20T14:00:00.000Z");
    await addBreadcrumb(db, trip.id, DROPOFF.lat, DROPOFF.lng - 0.05 * DEGREES_PER_MILE, "2026-07-20T14:20:00.000Z");

    const result = await verifyTripPath(db, trip.id);
    expect(result.status).toBe("MATCHED");
    expect(result.deviationMiles).not.toBeNull();
    expect(result.deviationMiles!).toBeLessThan(PATH_TOLERANCE_MILES);
  });

  it("is MISMATCHED when the pickup end is far from where the trip says it started", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    // ~2 miles off pickup, dead on for dropoff — the worse of the two decides.
    await addBreadcrumb(db, trip.id, PICKUP.lat + 2 * DEGREES_PER_MILE, PICKUP.lng, "2026-07-20T14:00:00.000Z");
    await addBreadcrumb(db, trip.id, DROPOFF.lat, DROPOFF.lng, "2026-07-20T14:20:00.000Z");

    const result = await verifyTripPath(db, trip.id);
    expect(result.status).toBe("MISMATCHED");
    expect(result.deviationMiles!).toBeGreaterThan(PATH_TOLERANCE_MILES);
  });

  it("is MISMATCHED when only the dropoff end is off, even if pickup was exact", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    await addBreadcrumb(db, trip.id, PICKUP.lat, PICKUP.lng, "2026-07-20T14:00:00.000Z");
    await addBreadcrumb(db, trip.id, DROPOFF.lat + 2 * DEGREES_PER_MILE, DROPOFF.lng, "2026-07-20T14:20:00.000Z");

    const result = await verifyTripPath(db, trip.id);
    expect(result.status).toBe("MISMATCHED");
  });

  it("uses the earliest and latest breadcrumb by recorded time, not insertion order", async () => {
    // A phone that lost signal can upload its backlog out of order — the
    // endpoints must come from when the device says it was there, not from
    // whatever order the rows landed in the table.
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    // Inserted out of chronological order on purpose.
    await addBreadcrumb(db, trip.id, DROPOFF.lat, DROPOFF.lng, "2026-07-20T14:20:00.000Z");
    await addBreadcrumb(db, trip.id, PICKUP.lat + 2 * DEGREES_PER_MILE, PICKUP.lng, "2026-07-20T14:00:00.000Z");
    await addBreadcrumb(db, trip.id, PICKUP.lat, PICKUP.lng, "2026-07-20T13:59:00.000Z");

    const result = await verifyTripPath(db, trip.id);
    // The true earliest point (13:59) is right on pickup, so this should
    // read as MATCHED — if the check used insertion order instead it would
    // wrongly anchor on the 14:00 point and call it MISMATCHED.
    expect(result.status).toBe("MATCHED");
  });
});

describe("recordTripPathVerification", () => {
  it("persists the computed result onto the trip row", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);
    await addBreadcrumb(db, trip.id, PICKUP.lat + 2 * DEGREES_PER_MILE, PICKUP.lng, "2026-07-20T14:00:00.000Z");
    await addBreadcrumb(db, trip.id, DROPOFF.lat, DROPOFF.lng, "2026-07-20T14:20:00.000Z");

    // Fresh from makeTrip: nothing has run the check yet, so this is the
    // starting point every trip actually has until it completes.
    expect(trip.pathVerification).toBe("NOT_CHECKED");
    expect(trip.pathDeviationMiles).toBeNull();

    const returned = await recordTripPathVerification(db, trip.id);
    expect(returned.status).toBe("MISMATCHED");

    const [row] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
    expect(row!.pathVerification).toBe("MISMATCHED");
    expect(row!.pathDeviationMiles).toBe(returned.deviationMiles);
  });

  it("persists NOT_CHECKED, not a false MATCHED, when there is nothing to check", async () => {
    const db = createDb(env.DB);
    const trip = await makeTrip(db);

    await recordTripPathVerification(db, trip.id);

    const [row] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
    expect(row!.pathVerification).toBe("NOT_CHECKED");
    expect(row!.pathDeviationMiles).toBeNull();
  });
});
