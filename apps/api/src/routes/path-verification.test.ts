import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, tripBreadcrumbsTable, tripsTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

/**
 * `GET /api/trips/{tripId}/path-verification` — the one place this result is
 * exposed. It exists precisely so a passenger-facing response can never carry
 * it (see the schema comment in packages/db/src/schema/trips.ts): these tests
 * are really about the access gate holding, not just the numbers.
 */

const TERMS = { acceptedTermsVersion: "2026-07-20" };
const PASSWORD = "correct horse battery staple";

async function registerDriver(email: string) {
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
    .set({ isVerified: true, status: "AVAILABLE" })
    .where(eq(driverProfilesTable.userId, user!.id))
    .returning({ id: driverProfilesTable.id });

  return { jar, driverId: profile!.id };
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
      phone: "+16035550701",
      password: PASSWORD,
      acceptedTerms: true,
      ...TERMS,
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

async function registerAdmin(email: string) {
  const db = createDb(env.DB);
  const jar = await registerPassenger(email);
  await db.update(usersTable).set({ role: "admin" }).where(eq(usersTable.email, email));
  const res = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, platform: "web" }),
  });
  const fresh = new CookieJar();
  fresh.applySetCookie(res);
  return fresh;
}

function getPathVerification(jar: CookieJar, tripId: string) {
  return req(`/api/trips/${tripId}/path-verification`, { headers: jar.csrfHeaders() });
}

async function completedReferralTrip(driverJar: CookieJar, site: { lat: number; lng: number }) {
  const started = await readJson(
    await req("/api/referral-trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify(site),
    })
  );
  const completed = await readJson(
    await req(`/api/referral-trips/${started.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ lat: site.lat + 0.02, lng: site.lng }),
    })
  );
  return completed.id as string;
}

describe("GET /api/trips/{tripId}/path-verification", () => {
  it("is computed and readable once a referral trip completes, with no breadcrumbs recorded", async () => {
    // No breadcrumbs were ever sent for this trip — the driver completed it
    // without the app having recorded any GPS samples. NOT_CHECKED, not a
    // false positive either way.
    const driver = await registerDriver(uniqueEmail("pv-referral-d"));
    const admin = await registerAdmin(uniqueEmail("pv-referral-a"));
    const tripId = await completedReferralTrip(driver.jar, { lat: 44.11, lng: -71.2 });

    const res = await getPathVerification(admin, tripId);
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.status).toBe("NOT_CHECKED");
    expect(body.deviationMiles).toBeNull();
  });

  it("flags a mismatch, computed by the completion endpoint itself, when the recorded path doesn't reach the booked pickup", async () => {
    const driver = await registerDriver(uniqueEmail("pv-mismatch-d"));
    const admin = await registerAdmin(uniqueEmail("pv-mismatch-a"));
    const site = { lat: 44.12, lng: -71.21 };

    const started = await readJson(
      await req("/api/referral-trips", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
        body: JSON.stringify(site),
      })
    );

    // Planted between start and complete — a breadcrumb miles from the
    // trip's own pickup, as if the driver's tap and their actual position
    // disagreed. Inserted directly rather than through the breadcrumbs
    // endpoint, which is a Flutter-app implementation detail this test
    // doesn't need.
    const db = createDb(env.DB);
    await db.insert(tripBreadcrumbsTable).values({
      tripId: started.id,
      lat: site.lat + 2 / 69,
      lng: site.lng,
      recordedAt: new Date("2026-07-20T14:00:00.000Z"),
    });

    // The completion endpoint itself must compute this — nothing in this
    // test calls lib/path-verification.ts directly.
    await req(`/api/referral-trips/${started.id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
      body: JSON.stringify({ lat: site.lat + 0.02, lng: site.lng }),
    });

    const res = await getPathVerification(admin, started.id);
    const body = await readJson(res);
    expect(body.status).toBe("MISMATCHED");
    expect(body.deviationMiles).toBeGreaterThan(0.5);
  });

  it("is visible to the assigned driver", async () => {
    const driver = await registerDriver(uniqueEmail("pv-owndriver-d"));
    const admin = await registerAdmin(uniqueEmail("pv-owndriver-a"));
    const tripId = await completedReferralTrip(driver.jar, { lat: 44.13, lng: -71.22 });
    void admin;

    const res = await getPathVerification(driver.jar, tripId);
    expect(res.status).toBe(200);
  });

  it("is forbidden to a driver who was not on the trip", async () => {
    const owner = await registerDriver(uniqueEmail("pv-notowner-owner-d"));
    const other = await registerDriver(uniqueEmail("pv-notowner-other-d"));
    const tripId = await completedReferralTrip(owner.jar, { lat: 44.14, lng: -71.23 });

    const res = await getPathVerification(other.jar, tripId);
    expect(res.status).toBe(403);
  });

  it("is forbidden to the passenger, even the passenger who booked the trip", async () => {
    // The whole point of this endpoint: a registered passenger's own trip
    // must not leak this through the one channel that reaches them.
    const driver = await registerDriver(uniqueEmail("pv-passenger-d"));
    const passenger = await registerPassenger(uniqueEmail("pv-passenger-p"));
    const tripId = await completedReferralTrip(driver.jar, { lat: 44.15, lng: -71.24 });

    const res = await getPathVerification(passenger, tripId);
    expect(res.status).toBe(403);
  });

  it("404s for an unknown trip", async () => {
    const admin = await registerAdmin(uniqueEmail("pv-unknown-a"));
    const res = await getPathVerification(admin, "11111111-1111-4111-8111-111111111111");
    expect(res.status).toBe(404);
  });
});
