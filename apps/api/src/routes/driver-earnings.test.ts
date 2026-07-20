import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

// D1 storage is shared across `it()`s in one file (isolated per *file*, not
// per test — see gnncab-workers-gotchas memory), so a driver left AVAILABLE
// at the same coordinates by an earlier test would compete as "nearest" for
// a later test's trip. Each test gets its own whole-degree-separated region.
function region(baseLat: number) {
  return {
    pickup: { pickupLat: baseLat, pickupLng: -71.1273, pickupAddress: "Main St" },
    dropoff: { dropoffLat: baseLat + 0.03, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" },
  };
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
      phone: "+16035550050",
      acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

async function registerAvailableNearbyDriver(email: string, pickupLat: number, pickupLng: number) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550051",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: pickupLat, currentLng: pickupLng })
    .where(eq(driverProfilesTable.userId, user!.id));

  return jar;
}

async function completeTrip(driverJar: CookieJar, passengerJar: CookieJar, pickup: object, dropoff: object) {
  const createRes = await req("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
    body: JSON.stringify({ ...pickup, ...dropoff, paymentMethod: "cash" }),
  });
  const trip = await readJson(createRes);
  expect(trip.status).toBe("DRIVER_ASSIGNED");

  let last;
  for (const status of ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"]) {
    last = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status }),
    });
    expect(last.status).toBe(200);
  }
  return readJson(last!);
}

describe("GET /api/driver/earnings", () => {
  it("sums completed trips into a totalEarnings figure matching the trip's final fare", async () => {
    const { pickup, dropoff } = region(44.0);
    const driverJar = await registerAvailableNearbyDriver(uniqueEmail("earnings-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("earnings-passenger"));
    const completed = await completeTrip(driverJar, passengerJar, pickup, dropoff);

    const res = await req("/api/driver/earnings", { headers: { Cookie: driverJar.header() } });
    expect(res.status).toBe(200);
    const body = await readJson(res);

    expect(body.tripCount).toBe(1);
    expect(body.totalEarnings).toBeCloseTo(completed.finalFare);
    expect(body.trips).toHaveLength(1);
    expect(body.trips[0].tripId).toBe(completed.id);
  });

  it("excludes trips outside the requested date range", async () => {
    const { pickup, dropoff } = region(45.0);
    const driverJar = await registerAvailableNearbyDriver(
      uniqueEmail("earnings-driver-range"),
      pickup.pickupLat,
      pickup.pickupLng
    );
    const passengerJar = await registerPassenger(uniqueEmail("earnings-passenger-range"));
    await completeTrip(driverJar, passengerJar, pickup, dropoff);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await req(`/api/driver/earnings?from=${encodeURIComponent(future)}`, {
      headers: { Cookie: driverJar.header() },
    });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.tripCount).toBe(0);
    expect(body.totalEarnings).toBe(0);
  });

  it("does not count a trip that hasn't completed yet", async () => {
    const { pickup, dropoff } = region(46.0);
    const driverJar = await registerAvailableNearbyDriver(
      uniqueEmail("earnings-driver-pending"),
      pickup.pickupLat,
      pickup.pickupLng
    );
    const passengerJar = await registerPassenger(uniqueEmail("earnings-passenger-pending"));

    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...pickup, ...dropoff, paymentMethod: "cash" }),
    });
    expect((await readJson(res)).status).toBe("DRIVER_ASSIGNED");

    const earningsRes = await req("/api/driver/earnings", { headers: { Cookie: driverJar.header() } });
    expect((await readJson(earningsRes)).tripCount).toBe(0);
  });
});
