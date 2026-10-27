import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { MAX_SEARCH_ROUNDS } from "../lib/dispatch";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

// D1 storage is shared across `it()`s in one file (isolated per *file*, not
// per test — see gnncab-workers-gotchas memory). A driver left AVAILABLE by
// an earlier test would otherwise compete as "nearest" in a later one, so
// each test gets its own pickup region a whole degree apart (~69mi, far
// outside the 10mi dispatch radius) to guarantee no cross-test interference.
function region(baseLat: number) {
  return {
    pickup: { pickupLat: baseLat, pickupLng: -71.1273, pickupAddress: "Main St" },
    dropoff: { dropoffLat: baseLat + 0.03, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" },
  };
}

/** Registers a driver AVAILABLE + verified, `offset` degrees further from
 * pickup than the previous one (0 = essentially on top of it) so multiple
 * drivers in the same region dispatch in a deterministic nearest-first order. */
async function registerRankedDriver(email: string, pickupLat: number, pickupLng: number, offset: number) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550030",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: pickupLat + offset, currentLng: pickupLng + offset })
    .where(eq(driverProfilesTable.userId, user!.id));

  const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return { jar, driverProfileId: dp!.id };
}

async function createTrip(passengerJar: CookieJar, pickup: object, dropoff: object) {
  const res = await req("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
    body: JSON.stringify({ ...pickup, ...dropoff, paymentMethod: "cash" }),
  });
  return readJson(res);
}

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550031",
      acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

describe("DispatchCoordinator — redispatch & timeout", () => {
  it("redispatches to the next-nearest driver when the assigned one rejects", async () => {
    const { pickup, dropoff } = region(44.0);
    const near = await registerRankedDriver(uniqueEmail("do-near"), pickup.pickupLat, pickup.pickupLng, 0);
    const far = await registerRankedDriver(uniqueEmail("do-far"), pickup.pickupLat, pickup.pickupLng, 0.05);
    const passengerJar = await registerPassenger(uniqueEmail("do-passenger"));

    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.driverId).toBe(near.driverProfileId);

    const rejectRes = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...near.jar.csrfHeaders() },
      body: JSON.stringify({ status: "DRIVER_REJECTED" }),
    });
    expect(rejectRes.status).toBe(200);

    const afterRes = await req(`/api/trips/${trip.id}`, { headers: { Cookie: passengerJar.header() } });
    const after = await readJson(afterRes);
    expect(after.status).toBe("DRIVER_ASSIGNED");
    expect(after.driverId).toBe(far.driverProfileId);
  });

  it("marks DRIVER_NO_RESPONSE and redispatches when the Alarm fires unanswered", async () => {
    const { pickup, dropoff } = region(45.0);
    const near = await registerRankedDriver(uniqueEmail("do-alarm-near"), pickup.pickupLat, pickup.pickupLng, 0);
    const far = await registerRankedDriver(uniqueEmail("do-alarm-far"), pickup.pickupLat, pickup.pickupLng, 0.05);
    const passengerJar = await registerPassenger(uniqueEmail("do-alarm-passenger"));

    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.driverId).toBe(near.driverProfileId);

    const id = env.DISPATCH_COORDINATOR.idFromName(trip.id);
    const stub = env.DISPATCH_COORDINATOR.get(id);
    const ran = await runDurableObjectAlarm(stub);
    expect(ran).toBe(true);

    const afterRes = await req(`/api/trips/${trip.id}`, { headers: { Cookie: passengerJar.header() } });
    const after = await readJson(afterRes);
    expect(after.status).toBe("DRIVER_ASSIGNED");
    expect(after.driverId).toBe(far.driverProfileId);

    const db = createDb(env.DB);
    const [nearDp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, near.driverProfileId)).limit(1);
    expect(nearDp!.status).toBe("AVAILABLE"); // freed after no-response
  });

  it("schedules another sweep once everyone nearby has declined", async () => {
    const { pickup, dropoff } = region(46.0);
    const d1 = await registerRankedDriver(uniqueEmail("do-max1"), pickup.pickupLat, pickup.pickupLng, 0);
    const d2 = await registerRankedDriver(uniqueEmail("do-max2"), pickup.pickupLat, pickup.pickupLng, 0.02);
    const d3 = await registerRankedDriver(uniqueEmail("do-max3"), pickup.pickupLat, pickup.pickupLng, 0.04);
    const passengerJar = await registerPassenger(uniqueEmail("do-max-passenger"));

    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.driverId).toBe(d1.driverProfileId);

    for (const driver of [d1, d2, d3]) {
      const res = await req(`/api/trips/${trip.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
        body: JSON.stringify({ status: "DRIVER_REJECTED" }),
      });
      expect(res.status).toBe(200);
    }

    // Exhausting one sweep no longer kills the trip — a driver who declined
    // now may well be free in a minute, so we back off and look again.
    const afterRes = await req(`/api/trips/${trip.id}`, { headers: { Cookie: passengerJar.header() } });
    const after = await readJson(afterRes);
    expect(after.status).toBe("REQUESTED");
    expect(after.searchAttempts).toBeGreaterThanOrEqual(1);
    expect(after.nextSearchAt).not.toBeNull();
  });

  it("gives up only after the whole search budget is spent, and can then be retried", async () => {
    const { pickup, dropoff } = region(47.0);
    const passengerJar = await registerPassenger(uniqueEmail("do-budget-passenger"));

    // No drivers exist in this region at all, so every sweep comes up empty.
    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.status).toBe("REQUESTED");

    // Burn the remaining rounds by firing the Alarm directly instead of
    // waiting 15 real minutes.
    const stub = env.DISPATCH_COORDINATOR.get(env.DISPATCH_COORDINATOR.idFromName(trip.id));
    for (let i = 0; i < MAX_SEARCH_ROUNDS; i++) {
      await runDurableObjectAlarm(stub);
    }

    const timedOut = await readJson(await req(`/api/trips/${trip.id}`, { headers: { Cookie: passengerJar.header() } }));
    expect(timedOut.status).toBe("TIMEOUT");

    // The passenger opts back in.
    const retryRes = await req(`/api/trips/${trip.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
    });
    expect(retryRes.status).toBe(200);
    const retried = await readJson(retryRes);
    expect(retried.status).toBe("REQUESTED");
    expect(retried.searchAttempts).toBeLessThanOrEqual(1);
  // Fifteen real D1/DO alarm rounds need more than the default 5s under load.
  }, 15_000);

  it("stops searching once the passenger cancels", async () => {
    const { pickup, dropoff } = region(48.0);
    const passengerJar = await registerPassenger(uniqueEmail("do-cancel-passenger"));

    const trip = await createTrip(passengerJar, pickup, dropoff);
    expect(trip.status).toBe("REQUESTED");

    const cancelRes = await req(`/api/trips/${trip.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect(cancelRes.status).toBe(200);

    // Even if a stale Alarm fires, a cancelled trip must not be revived.
    const stub = env.DISPATCH_COORDINATOR.get(env.DISPATCH_COORDINATOR.idFromName(trip.id));
    await runDurableObjectAlarm(stub);

    const after = await readJson(await req(`/api/trips/${trip.id}`, { headers: { Cookie: passengerJar.header() } }));
    expect(after.status).toBe("TRIP_CANCELLED");
  });
});
