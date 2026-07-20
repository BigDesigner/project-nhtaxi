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
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550300",
      password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

// Storage in vitest-pool-workers is isolated per test *file*, not per test,
// so every driver created here stays AVAILABLE for the tests that follow.
// Dispatch tests therefore each work in their own patch of map, far enough
// apart (1° latitude ≈ 69 miles vs a 10-mile dispatch radius) that no other
// test's drivers can be candidates. Without this, "the nearest driver" is
// whichever of several equidistant leftovers the query happens to return.
const site = (degreesNorth: number) => ({
  pickupLat: 44.0567 + degreesNorth,
  pickupLng: -71.1273,
  pickupAddress: "Main St",
});

/** Registers a driver and puts them in a known status/place with a known car. */
async function registerDriver(
  email: string,
  overrides: Partial<typeof driverProfilesTable.$inferInsert> = {},
  at: { pickupLat: number; pickupLng: number } = PICKUP
): Promise<{ jar: CookieJar; driverId: string }> {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550301",
      password: "correct horse battery staple",
      acceptedAgreement: true,
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [profile] = await db
    .update(driverProfilesTable)
    .set({
      isVerified: true,
      status: "AVAILABLE",
      currentLat: at.pickupLat,
      currentLng: at.pickupLng,
      vehicleMake: "Toyota",
      vehicleModel: "Sienna",
      vehicleColor: "Silver",
      vehiclePlate: "NH-1234",
      ...overrides,
    })
    .where(eq(driverProfilesTable.userId, user!.id))
    .returning({ id: driverProfilesTable.id });

  return { jar, driverId: profile!.id };
}

describe("GET /api/drivers", () => {
  it("returns working drivers with their car, status and position", async () => {
    const { driverId } = await registerDriver(uniqueEmail("dir-available"));
    const jar = await registerPassenger(uniqueEmail("dir-passenger"));

    const res = await req("/api/drivers", { headers: { Cookie: jar.header() } });
    expect(res.status).toBe(200);

    const { drivers } = await readJson(res);
    const mine = drivers.find((d: { driverId: string }) => d.driverId === driverId);
    expect(mine).toBeDefined();
    expect(mine.status).toBe("AVAILABLE");
    expect(mine.vehiclePlate).toBe("NH-1234");
    expect(mine.vehicleModel).toBe("Sienna");
    expect(mine.firstName).toBe("Dan");
    expect(mine.lat).toBeCloseTo(PICKUP.pickupLat);
  });

  it("leaves out anything a passenger has no business seeing", async () => {
    await registerDriver(uniqueEmail("dir-narrow"), { licenseNumber: "SECRET-LICENCE-1", rating: 4.2 });
    const jar = await registerPassenger(uniqueEmail("dir-narrow-passenger"));

    const { drivers } = await readJson(await req("/api/drivers", { headers: { Cookie: jar.header() } }));
    expect(drivers.length).toBeGreaterThan(0);
    for (const d of drivers) {
      expect(d).not.toHaveProperty("licenseNumber");
      expect(d).not.toHaveProperty("rating");
      expect(d).not.toHaveProperty("isVerified");
      expect(d).not.toHaveProperty("lastName");
    }
  });

  it("hides drivers who are off duty", async () => {
    const { driverId } = await registerDriver(uniqueEmail("dir-offline"), { status: "OFFLINE" });
    const jar = await registerPassenger(uniqueEmail("dir-offline-passenger"));

    const { drivers } = await readJson(await req("/api/drivers", { headers: { Cookie: jar.header() } }));
    expect(drivers.find((d: { driverId: string }) => d.driverId === driverId)).toBeUndefined();
  });

  it("reports distance from the passenger when they share a position", async () => {
    await registerDriver(uniqueEmail("dir-distance"));
    const jar = await registerPassenger(uniqueEmail("dir-distance-passenger"));

    // ~7 miles north of the drivers.
    const res = await req(`/api/drivers?lat=44.16&lng=${PICKUP.pickupLng}`, { headers: { Cookie: jar.header() } });
    const { drivers } = await readJson(res);
    expect(drivers[0].distanceMiles).toBeGreaterThan(5);
    expect(drivers[0].distanceMiles).toBeLessThan(10);
  });

  it("rejects an unauthenticated caller", async () => {
    expect((await req("/api/drivers")).status).toBe(401);
  });
});

describe("preferred driver dispatch", () => {
  it("offers the trip to the driver the passenger picked", async () => {
    // Two identically-placed drivers: without the preference, which one gets
    // picked is arbitrary, so this only passes if the preference is honoured.
    const here = site(1);
    const first = await registerDriver(uniqueEmail("pref-a"), {}, here);
    const second = await registerDriver(uniqueEmail("pref-b"), {}, here);
    const jar = await registerPassenger(uniqueEmail("pref-passenger"));

    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ ...here, ...DROPOFF, paymentMethod: "cash", preferredDriverId: second.driverId }),
    });
    expect(res.status).toBe(201);

    const trip = await readJson(res);
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.driverId).toBe(second.driverId);
    expect(trip.driverId).not.toBe(first.driverId);
  });

  it("falls back to another driver when the pick is no longer free", async () => {
    const here = site(2);
    const fallback = await registerDriver(uniqueEmail("pref-fallback"), {}, here);
    const busy = await registerDriver(uniqueEmail("pref-busy"), { status: "BUSY" }, here);
    const jar = await registerPassenger(uniqueEmail("pref-fallback-passenger"));

    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ ...here, ...DROPOFF, paymentMethod: "cash", preferredDriverId: busy.driverId }),
    });

    const trip = await readJson(res);
    // The passenger still gets a car rather than an error or an endless search.
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.driverId).toBe(fallback.driverId);
  });
});

describe("cancellation after a driver is on the way", () => {
  async function bookAndAdvance(degreesNorth: number, statuses: string[]) {
    const here = site(degreesNorth);
    const driver = await registerDriver(uniqueEmail(`cancel-driver-${degreesNorth}`), {}, here);
    const jar = await registerPassenger(uniqueEmail(`cancel-passenger-${degreesNorth}`));

    const trip = await readJson(
      await req("/api/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
        body: JSON.stringify({ ...here, ...DROPOFF, paymentMethod: "cash" }),
      })
    );
    // Assert the setup landed on *this* driver — otherwise the transitions
    // below would silently no-op and the test would pass for the wrong reason.
    expect(trip.driverId).toBe(driver.driverId);

    for (const status of statuses) {
      const res = await req(`/api/trips/${trip.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
        body: JSON.stringify({ status }),
      });
      expect(res.status).toBe(200);
    }
    return { trip, jar };
  }

  it("still lets the passenger cancel after the driver merely accepts", async () => {
    const { trip, jar } = await bookAndAdvance(3, ["DRIVER_ACCEPTED"]);

    const res = await req(`/api/trips/${trip.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).status).toBe("TRIP_CANCELLED");
  });

  it("refuses once the driver is en route, and says why", async () => {
    const { trip, jar } = await bookAndAdvance(4, ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE"]);

    const res = await req(`/api/trips/${trip.id}/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ reason: "Changed my mind" }),
    });
    expect(res.status).toBe(400);
    expect((await readJson(res)).message).toMatch(/call dispatch/i);
  });
});
