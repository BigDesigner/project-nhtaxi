import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDb,
  driverProfilesTable,
  driverTripCommissionsTable,
  tripBreadcrumbsTable,
  tripsTable,
  usersTable,
} from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";
import { failRouting, STUB_ROUTE_MILES } from "../../test/stub-routing";

/**
 * The Referral button: a job the office phoned straight to the driver, for a
 * passenger who is not in the app.
 *
 * What these tests are really protecting is that the fare comes out *computed*
 * rather than *declared*. The driver never types a distance or a price — they
 * tap at the kerb and tap again at the destination, and the server prices the
 * road between those two points. Every assertion about money below is there
 * because GNN LLC's commission on a referred job rests on that number.
 */

const TERMS = { acceptedTermsVersion: "2026-07-20" };
const PASSWORD = "correct horse battery staple";

/** Storage is shared per test file, so each test works in its own patch of map. */
const site = (n: number) => ({ lat: 44.05 + n * 0.01, lng: -71.12 });
const dropSite = (n: number) => ({ lat: 44.05 + n * 0.01, lng: -71.2 });

afterEach(() => failRouting(false));

async function registerDriver(email: string, {verified = true} = {}) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550700",
      password: PASSWORD,
      acceptedAgreement: true,
      ...TERMS,
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [profile] = await db
    .update(driverProfilesTable)
    .set({ isVerified: verified, status: "AVAILABLE" })
    .where(eq(driverProfilesTable.userId, user!.id))
    .returning({ id: driverProfilesTable.id });

  return { jar, driverId: profile!.id };
}

function startReferral(jar: CookieJar, body: Record<string, unknown>) {
  return req("/api/referral-trips", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
    body: JSON.stringify(body),
  });
}

function completeReferral(jar: CookieJar, tripId: string, body: Record<string, unknown>) {
  return req(`/api/referral-trips/${tripId}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
    body: JSON.stringify(body),
  });
}

async function tripRow(tripId: string) {
  const db = createDb(env.DB);
  const [row] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  return row!;
}

describe("opening a referral trip at the kerb", () => {
  it("starts a trip already in progress, from the driver's own position", async () => {
    // No booking exists, so there is nothing to accept and nobody to dispatch.
    // The passenger is getting into the car as the button is pressed.
    const driver = await registerDriver(uniqueEmail("rt-open-d"));
    const at = site(1);

    const res = await startReferral(driver.jar, { ...at, address: "Eastern Slope Inn", guestName: "Walk-in" });
    expect(res.status).toBe(201);

    const trip = await readJson(res);
    expect(trip.status).toBe("TRIP_STARTED");
    expect(trip.origin).toBe("DRIVER_REFERRAL");
    expect(trip.referralSource).toBe("DRIVER_DECLARED");
    expect(trip.customerId).toBeNull();
    expect(trip.pickupLat).toBe(at.lat);
    expect(trip.dropoffLat).toBeNull();
    // Snapshotted at the kerb so a rate change mid-trip cannot rewrite it.
    expect(trip.commissionPercent).toBeGreaterThan(0);
  });

  it("falls back to the coordinates when the phone could not name the place", async () => {
    // A dead spot must never be the reason a driver cannot start a job. The
    // coordinates are the part that actually prices the trip.
    const driver = await registerDriver(uniqueEmail("rt-noaddr-d"));
    const at = site(2);

    const trip = await readJson(await startReferral(driver.jar, at));
    expect(trip.pickupAddress).toContain(at.lat.toFixed(5));
  });

  it("refuses a second job while one is still running", async () => {
    const driver = await registerDriver(uniqueEmail("rt-busy-d"));
    await startReferral(driver.jar, site(3));

    const res = await startReferral(driver.jar, site(4));
    expect(res.status).toBe(409);
  });

  it("refuses a driver the office has not approved yet", async () => {
    // Every other route to a job runs through dispatch, which only offers work
    // to approved drivers. This one bypasses dispatch, so without a check here
    // someone whose licence the office has never seen could open real,
    // billable trips. The app hides the button, but a UI-only gate is not one.
    const driver = await registerDriver(uniqueEmail("rt-unverified-d"), {verified: false});

    const res = await startReferral(driver.jar, site(15));
    expect(res.status).toBe(403);
  });

  it("is not something a passenger can call", async () => {
    const jar = new CookieJar();
    const email = uniqueEmail("rt-passenger");
    jar.applySetCookie(
      await req("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: "Pat",
          lastName: "Passenger",
          email,
          phone: "+16035550701",
          password: PASSWORD,
          acceptedTerms: true,
          ...TERMS,
        }),
      })
    );

    const res = await startReferral(jar, site(5));
    expect(res.status).toBe(403);
  });
});

describe("closing a referral trip", () => {
  it("prices the road actually driven and charges commission on it", async () => {
    const driver = await registerDriver(uniqueEmail("rt-close-d"));
    const started = await readJson(await startReferral(driver.jar, site(6)));

    const res = await completeReferral(driver.jar, started.id, { ...dropSite(6), address: "Settlers Green" });
    expect(res.status).toBe(200);

    const trip = await readJson(res);
    expect(trip.status).toBe("TRIP_COMPLETED");
    // The distance came from the routing lookup, not from anything the driver
    // typed — there is no field in this flow for them to type one into.
    expect(trip.distanceMiles).toBe(STUB_ROUTE_MILES);
    expect(trip.finalFare).toBeGreaterThan(0);
    expect(trip.dropoffAddress).toBe("Settlers Green");

    const db = createDb(env.DB);
    const [charge] = await db
      .select()
      .from(driverTripCommissionsTable)
      .where(eq(driverTripCommissionsTable.tripId, started.id));
    expect(charge).toBeDefined();
    // Commission is a cut of the computed fare, at the snapshotted rate.
    expect(charge!.commissionCents).toBe(
      Math.round((Math.round(trip.finalFare * 100) * charge!.commissionPercent) / 100)
    );
  });

  it("frees the driver up for the next job", async () => {
    const driver = await registerDriver(uniqueEmail("rt-free-d"));
    const started = await readJson(await startReferral(driver.jar, site(7)));
    await completeReferral(driver.jar, started.id, dropSite(7));

    const db = createDb(env.DB);
    const [profile] = await db
      .select()
      .from(driverProfilesTable)
      .where(eq(driverProfilesTable.id, driver.driverId))
      .limit(1);
    expect(profile!.status).toBe("AVAILABLE");
    expect(profile!.totalTrips).toBe(1);
  });

  it("refuses when routing cannot say how far it was, and leaves the trip open", async () => {
    // Fail-closed. A referral trip has no earlier estimate to fall back on, so
    // without a real road distance there is no honest number to charge — and
    // crucially the trip must stay in progress so the driver can simply tap
    // again, rather than being left completed at a guessed price.
    const driver = await registerDriver(uniqueEmail("rt-noroute-d"));
    const started = await readJson(await startReferral(driver.jar, site(8)));

    failRouting();
    const res = await completeReferral(driver.jar, started.id, dropSite(8));
    expect(res.status).toBe(503);

    const row = await tripRow(started.id);
    expect(row.status).toBe("TRIP_STARTED");
    expect(row.finalFareCents).toBeNull();

    const db = createDb(env.DB);
    expect(
      await db.select().from(driverTripCommissionsTable).where(eq(driverTripCommissionsTable.tripId, started.id))
    ).toHaveLength(0);
  });

  it("will not let one driver close another driver's job", async () => {
    const owner = await registerDriver(uniqueEmail("rt-owner-d"));
    const other = await registerDriver(uniqueEmail("rt-other-d"));
    const started = await readJson(await startReferral(owner.jar, site(9)));

    const res = await completeReferral(other.jar, started.id, dropSite(9));
    expect(res.status).toBe(403);
  });

  it("refuses a trip that is already finished", async () => {
    const driver = await registerDriver(uniqueEmail("rt-twice-d"));
    const started = await readJson(await startReferral(driver.jar, site(10)));
    await completeReferral(driver.jar, started.id, dropSite(10));

    // Without this the driver could double-charge themselves commission by
    // tapping twice on a bad connection.
    const res = await completeReferral(driver.jar, started.id, dropSite(10));
    expect(res.status).toBe(400);
  });
});

describe("breadcrumbs — where the car actually went", () => {
  it("records the path and returns it in the order it was driven", async () => {
    // Deliberately uploaded newest-first: a phone that lost signal sends its
    // backlog in whatever order it likes, and the route must still draw
    // correctly. That is why recordedAt comes from the device.
    const driver = await registerDriver(uniqueEmail("rt-bc-d"));
    const started = await readJson(await startReferral(driver.jar, site(11)));

    const res = await req(`/api/trips/${started.id}/breadcrumbs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
      body: JSON.stringify({
        points: [
          { lat: 44.07, lng: -71.15, recordedAt: "2026-07-20T14:02:00.000Z" },
          { lat: 44.06, lng: -71.13, recordedAt: "2026-07-20T14:01:00.000Z" },
        ],
      }),
    });
    expect(res.status).toBe(201);
    expect((await readJson(res)).recorded).toBe(2);

    const path = await readJson(await req(`/api/trips/${started.id}/breadcrumbs`, { headers: driver.jar.csrfHeaders() }));
    expect(path.map((p: { lat: number }) => p.lat)).toEqual([44.06, 44.07]);
  });

  it("does not change the fare", async () => {
    // The whole point of the schema comment: breadcrumbs are evidence, not
    // billing. A wandering route must not become a bigger bill, and GPS jitter
    // must not quietly inflate every trip.
    const driver = await registerDriver(uniqueEmail("rt-bcfare-d"));
    const started = await readJson(await startReferral(driver.jar, site(12)));

    await req(`/api/trips/${started.id}/breadcrumbs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
      body: JSON.stringify({
        points: Array.from({ length: 20 }, (_, i) => ({
          lat: 44.5 + i,
          lng: -71.5,
          recordedAt: new Date(Date.UTC(2026, 6, 20, 14, i)).toISOString(),
        })),
      }),
    });

    const trip = await readJson(await completeReferral(driver.jar, started.id, dropSite(12)));
    expect(trip.distanceMiles).toBe(STUB_ROUTE_MILES);
  });

  it("closes the path once the trip is finished", async () => {
    // A finished trip's path is a record. A stale backlog arriving hours later
    // must not be able to append to the very trip the office is looking at.
    const driver = await registerDriver(uniqueEmail("rt-bcclosed-d"));
    const started = await readJson(await startReferral(driver.jar, site(13)));
    await completeReferral(driver.jar, started.id, dropSite(13));

    const res = await req(`/api/trips/${started.id}/breadcrumbs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
      body: JSON.stringify({ points: [{ lat: 44.9, lng: -71.9, recordedAt: "2026-07-20T18:00:00.000Z" }] }),
    });
    expect(res.status).toBe(400);

    const db = createDb(env.DB);
    expect(
      await db.select().from(tripBreadcrumbsTable).where(eq(tripBreadcrumbsTable.tripId, started.id))
    ).toHaveLength(0);
  });

  it("will not accept points from a driver who is not on the trip", async () => {
    const owner = await registerDriver(uniqueEmail("rt-bcowner-d"));
    const other = await registerDriver(uniqueEmail("rt-bcother-d"));
    const started = await readJson(await startReferral(owner.jar, site(14)));

    const res = await req(`/api/trips/${started.id}/breadcrumbs`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...other.jar.csrfHeaders() },
      body: JSON.stringify({ points: [{ lat: 44.9, lng: -71.9, recordedAt: "2026-07-20T18:00:00.000Z" }] }),
    });
    expect(res.status).toBe(403);
  });
});
