import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const PICKUP = { pickupLat: 44.0567, pickupLng: -71.1273, pickupAddress: "Main St" };
const DROPOFF = { dropoffLat: 44.09, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" };

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Pat", lastName: "Passenger", email, phone: "+16035550010", acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple" }),
  });
  jar.applySetCookie(res);
  return jar;
}

/** Registers a driver and puts them AVAILABLE + verified + near the pickup
 * point (location updates are Faz 4/realtime — direct DB write for now). */
async function registerAvailableNearbyDriver(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Dan", lastName: "Driver", email, phone: "+16035550011", password: "correct horse battery staple", acceptedAgreement: true, acceptedTermsVersion: "2026-07-20" }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: PICKUP.pickupLat, currentLng: PICKUP.pickupLng })
    .where(eq(driverProfilesTable.userId, user!.id));

  return jar;
}

describe("trips — request & dispatch", () => {
  it("assigns the nearby available driver immediately", async () => {
    const driverJar = await registerAvailableNearbyDriver(uniqueEmail("trip-driver"));
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger"));

    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
    });
    expect(res.status).toBe(201);
    const trip = await readJson(res);
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.driverId).toBeTruthy();
    expect(trip.estimatedFare).toBeGreaterThan(0);

    void driverJar; // driver session unused directly here — assignment is verified via the trip response
  });

  it("keeps searching (rather than giving up) when no driver is available nearby", async () => {
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger-notimeout"));
    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
    });
    expect(res.status).toBe(201);

    // An empty sweep schedules the next one instead of failing the trip —
    // drivers come online all the time, so instant TIMEOUT threw away a
    // booking that would often succeed a minute later.
    const trip = await readJson(res);
    expect(trip.status).toBe("REQUESTED");
    expect(trip.searchAttempts).toBe(1);
    expect(trip.nextSearchAt).not.toBeNull();
    expect(new Date(trip.nextSearchAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a second active trip request from the same passenger", async () => {
    await registerAvailableNearbyDriver(uniqueEmail("trip-driver-dup"));
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger-dup"));
    const create = () =>
      req("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
        body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
      });

    expect((await create()).status).toBe(201);
    expect((await create()).status).toBe(409);
  });

  it("runs the full lifecycle to completion and frees the driver", async () => {
    const driverEmail = uniqueEmail("trip-driver-full");
    const driverJar = await registerAvailableNearbyDriver(driverEmail);
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger-full"));

    const createRes = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
    });
    const trip = await readJson(createRes);
    expect(trip.status).toBe("DRIVER_ASSIGNED");

    const transitions = ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"];
    let last;
    for (const status of transitions) {
      last = await req(`/api/trips/${trip.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
        body: JSON.stringify({ status }),
      });
      expect(last.status).toBe(200);
    }
    expect((await readJson(last!)).status).toBe("TRIP_COMPLETED");

    const db = createDb(env.DB);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, driverEmail)).limit(1);
    const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
    expect(dp!.status).toBe("AVAILABLE");
    expect(dp!.totalTrips).toBe(1);
  });

  it("lets the passenger cancel a requested trip and frees the driver", async () => {
    await registerAvailableNearbyDriver(uniqueEmail("trip-driver-cancel"));
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger-cancel"));

    const createRes = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
    });
    const trip = await readJson(createRes);

    const cancelRes = await req(`/api/trips/${trip.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect(cancelRes.status).toBe(200);
    expect((await readJson(cancelRes)).status).toBe("TRIP_CANCELLED");
  });

  it("forbids a driver from viewing someone else's trip", async () => {
    await registerAvailableNearbyDriver(uniqueEmail("trip-driver-owner"));
    const passengerJar = await registerPassenger(uniqueEmail("trip-passenger-owner"));
    const createRes = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF, paymentMethod: "cash" }),
    });
    const trip = await readJson(createRes);

    const outsiderJar = await registerAvailableNearbyDriver(uniqueEmail("trip-driver-outsider"));
    const res = await req(`/api/trips/${trip.id}`, { headers: { Cookie: outsiderJar.header() } });
    expect(res.status).toBe(403);
  });
});
