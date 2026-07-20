import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, driverTripCommissionsTable, tripsTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

/**
 * Commission is owed only on jobs GNN LLC referred.
 *
 * The business model this encodes: drivers pay rent for time on the app, and
 * finding work through ordinary dispatch is what that rent buys. Taking a cut
 * of *everything* would be charging twice. So `referralSource` — not `origin`
 * — decides, and these tests pin who is allowed to set it.
 */

const DROPOFF = { dropoffLat: 44.09, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" };
const TERMS = { acceptedTermsVersion: "2026-07-20" };

/** Each test works in its own patch of map — storage is shared per file. */
const site = (n: number) => ({ pickupLat: 44.0567 + n, pickupLng: -71.1273, pickupAddress: "Main St" });

async function registerDriver(email: string, at: { pickupLat: number; pickupLng: number }) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550700",
      password: "correct horse battery staple",
      acceptedAgreement: true,
      ...TERMS,
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [profile] = await db
    .update(driverProfilesTable)
    .set({ isVerified: true, status: "AVAILABLE", currentLat: at.pickupLat, currentLng: at.pickupLng })
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
      password: "correct horse battery staple",
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
  // Re-login so the session token carries the admin role.
  const res = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "correct horse battery staple", platform: "web" }),
  });
  const fresh = new CookieJar();
  fresh.applySetCookie(res);
  return fresh;
}

async function bookTrip(jar: CookieJar, at: ReturnType<typeof site>) {
  return readJson(
    await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ ...at, ...DROPOFF, paymentMethod: "cash" }),
    })
  );
}

function setStatus(jar: CookieJar, tripId: string, body: Record<string, unknown>) {
  return req(`/api/trips/${tripId}/status`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
    body: JSON.stringify(body),
  });
}

async function runToCompletion(jar: CookieJar, tripId: string, acceptBody: Record<string, unknown>) {
  await setStatus(jar, tripId, acceptBody);
  for (const status of ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"]) {
    const res = await setStatus(jar, tripId, { status });
    expect(res.status).toBe(200);
  }
}

async function commissionsFor(tripId: string) {
  const db = createDb(env.DB);
  return db.select().from(driverTripCommissionsTable).where(eq(driverTripCommissionsTable.tripId, tripId));
}

describe("commission follows referral, not origin", () => {
  it("charges nothing on an ordinary dispatched trip", async () => {
    // The rent already paid for this job. Charging commission too would be
    // charging twice for the same thing.
    const at = site(1);
    const driver = await registerDriver(uniqueEmail("ref-plain-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-plain-p"));
    const trip = await bookTrip(passenger, at);
    expect(trip.referralSource).toBe("NONE");

    await runToCompletion(driver.jar, trip.id, { status: "DRIVER_ACCEPTED" });
    expect(await commissionsFor(trip.id)).toHaveLength(0);
  });

  it("charges when the driver declares the office referred it", async () => {
    const at = site(2);
    const driver = await registerDriver(uniqueEmail("ref-declared-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-declared-p"));
    const trip = await bookTrip(passenger, at);

    await runToCompletion(driver.jar, trip.id, { status: "DRIVER_ACCEPTED", gnnReferred: true });

    const [charge] = await commissionsFor(trip.id);
    expect(charge).toBeDefined();
    expect(charge!.commissionCents).toBeGreaterThan(0);

    const db = createDb(env.DB);
    const [row] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
    expect(row!.referralSource).toBe("DRIVER_DECLARED");
  });

  it("will not let a driver clear a referral the office set", async () => {
    // The load-bearing rule. If `gnnReferred: false` could unset it, a driver
    // could opt out of commission on the very jobs the office handed them,
    // and the office would have no way to notice.
    const at = site(3);
    const driver = await registerDriver(uniqueEmail("ref-unset-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-unset-p"));
    const trip = await bookTrip(passenger, at);

    const db = createDb(env.DB);
    await db
      .update(tripsTable)
      .set({ referralSource: "ADMIN_MARKED", commissionPercent: 20 })
      .where(eq(tripsTable.id, trip.id));

    await runToCompletion(driver.jar, trip.id, { status: "DRIVER_ACCEPTED", gnnReferred: false });

    const [row] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
    expect(row!.referralSource).toBe("ADMIN_MARKED");
    expect(await commissionsFor(trip.id)).toHaveLength(1);
  });

  it("snapshots the rate at declaration, so a later change cannot rewrite it", async () => {
    const at = site(4);
    const driver = await registerDriver(uniqueEmail("ref-snapshot-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-snapshot-p"));
    const trip = await bookTrip(passenger, at);

    await setStatus(driver.jar, trip.id, { status: "DRIVER_ACCEPTED", gnnReferred: true });

    const db = createDb(env.DB);
    const [afterAccept] = await db.select().from(tripsTable).where(eq(tripsTable.id, trip.id)).limit(1);
    const agreedRate = afterAccept!.commissionPercent;
    expect(agreedRate).not.toBeNull();

    // The office changes the global rate mid-trip.
    await req("/api/admin/pricing", { method: "PUT" }).catch(() => {});

    for (const status of ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"]) {
      await setStatus(driver.jar, trip.id, { status });
    }

    const [charge] = await commissionsFor(trip.id);
    // Charged at what the driver was shown before accepting, not whatever the
    // rate happens to be at completion.
    expect(charge!.commissionPercent).toBe(agreedRate);
  });
});

describe("admin has the last word on referrals", () => {
  it("marks a trip as referred and starts charging commission", async () => {
    const at = site(5);
    const driver = await registerDriver(uniqueEmail("ref-admin-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-admin-p"));
    const adminJar = await registerAdmin(uniqueEmail("ref-admin-a"));
    const trip = await bookTrip(passenger, at);

    const res = await req(`/api/admin/trips/${trip.id}/referral`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ referred: true }),
    });
    expect(res.status).toBe(200);
    expect((await readJson(res)).referralSource).toBe("ADMIN_MARKED");

    await runToCompletion(driver.jar, trip.id, { status: "DRIVER_ACCEPTED" });
    expect(await commissionsFor(trip.id)).toHaveLength(1);
  });

  it("can take a referral back off, and then nothing is charged", async () => {
    const at = site(6);
    const driver = await registerDriver(uniqueEmail("ref-unmark-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-unmark-p"));
    const adminJar = await registerAdmin(uniqueEmail("ref-unmark-a"));
    const trip = await bookTrip(passenger, at);

    await setStatus(driver.jar, trip.id, { status: "DRIVER_ACCEPTED", gnnReferred: true });

    const res = await req(`/api/admin/trips/${trip.id}/referral`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ referred: false }),
    });
    expect(res.status).toBe(200);

    for (const status of ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"]) {
      await setStatus(driver.jar, trip.id, { status });
    }
    expect(await commissionsFor(trip.id)).toHaveLength(0);
  });

  it("refuses to change a finished trip", async () => {
    // The commission row is already written. Silently re-deriving money after
    // the fact is worse than making someone adjust the balance deliberately.
    const at = site(7);
    const driver = await registerDriver(uniqueEmail("ref-late-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-late-p"));
    const adminJar = await registerAdmin(uniqueEmail("ref-late-a"));
    const trip = await bookTrip(passenger, at);

    await runToCompletion(driver.jar, trip.id, { status: "DRIVER_ACCEPTED" });

    const res = await req(`/api/admin/trips/${trip.id}/referral`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ referred: true }),
    });
    expect(res.status).toBe(400);
  });

  it("is not something a driver can call", async () => {
    const at = site(8);
    const driver = await registerDriver(uniqueEmail("ref-forbidden-d"), at);
    const passenger = await registerPassenger(uniqueEmail("ref-forbidden-p"));
    const trip = await bookTrip(passenger, at);

    const res = await req(`/api/admin/trips/${trip.id}/referral`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driver.jar.csrfHeaders() },
      body: JSON.stringify({ referred: false }),
    });
    expect(res.status).toBe(403);
  });
});
