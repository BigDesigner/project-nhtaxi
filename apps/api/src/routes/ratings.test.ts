import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

/**
 * Passengers rate a completed trip on five 1–5 star questions. The rating
 * folds into the driver's headline average, and drives the review list a
 * passenger sees when tapping a driver.
 */

const DROPOFF = { dropoffLat: 44.09, dropoffLng: -71.18, dropoffAddress: "Mountain Rd" };
const TERMS = { acceptedTermsVersion: "2026-07-20" };
const FIVE_STARS = { courtesy: 5, safety: 5, punctuality: 5, communication: 5, cleanliness: 5 };

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

/** Runs a booked trip all the way to TRIP_COMPLETED with the driver aboard. */
async function completeTrip(driverJar: CookieJar, tripId: string) {
  await setStatus(driverJar, tripId, { status: "DRIVER_ACCEPTED" });
  for (const status of ["DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "TRIP_STARTED", "TRIP_COMPLETED"]) {
    const res = await setStatus(driverJar, tripId, { status });
    expect(res.status).toBe(200);
  }
}

function rate(jar: CookieJar, tripId: string, body: Record<string, unknown>) {
  return req(`/api/trips/${tripId}/rating`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
    body: JSON.stringify(body),
  });
}

async function setup(n: number) {
  const at = site(n);
  const driver = await registerDriver(uniqueEmail(`rate-d${n}`), at);
  const passenger = await registerPassenger(uniqueEmail(`rate-p${n}`));
  const trip = await bookTrip(passenger, at);
  await completeTrip(driver.jar, trip.id);
  return { driver, passenger, tripId: trip.id };
}

describe("submitting a rating", () => {
  it("rates a completed trip and moves the driver's headline average", async () => {
    const { driver, passenger, tripId } = await setup(1);

    const res = await rate(passenger, tripId, { ...FIVE_STARS, comment: "Great ride" });
    expect(res.status).toBe(201);
    const rating = await readJson(res);
    expect(rating.overall).toBe(5);

    const db = createDb(env.DB);
    const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, driver.driverId)).limit(1);
    expect(dp!.rating).toBe(5);
    expect(dp!.ratingCount).toBe(1);
  });

  it("averages the five questions into overall", async () => {
    const { passenger, tripId } = await setup(2);
    // (5+4+3+2+1)/5 = 3.0
    const res = await rate(passenger, tripId, { courtesy: 5, safety: 4, punctuality: 3, communication: 2, cleanliness: 1 });
    expect((await readJson(res)).overall).toBe(3);
  });

  it("refuses a second rating on the same trip", async () => {
    const { passenger, tripId } = await setup(3);
    expect((await rate(passenger, tripId, FIVE_STARS)).status).toBe(201);
    expect((await rate(passenger, tripId, FIVE_STARS)).status).toBe(409);
  });

  it("refuses a star outside 1–5", async () => {
    const { passenger, tripId } = await setup(4);
    const res = await rate(passenger, tripId, { ...FIVE_STARS, courtesy: 6 });
    expect(res.status).toBe(400);
  });

  it("will not let anyone but the trip's passenger rate it", async () => {
    const { driver, tripId } = await setup(5);
    const otherPassenger = await registerPassenger(uniqueEmail("rate-other"));

    // The driver on the trip.
    expect((await rate(driver.jar, tripId, FIVE_STARS)).status).toBe(403);
    // A different passenger who isn't on this trip.
    expect((await rate(otherPassenger, tripId, FIVE_STARS)).status).toBe(403);
  });

  it("refuses to rate a trip that is not completed", async () => {
    const at = site(6);
    const driver = await registerDriver(uniqueEmail("rate-live-d"), at);
    const passenger = await registerPassenger(uniqueEmail("rate-live-p"));
    const trip = await bookTrip(passenger, at);
    await setStatus(driver.jar, trip.id, { status: "DRIVER_ACCEPTED" });

    const res = await rate(passenger, trip.id, FIVE_STARS);
    expect(res.status).toBe(400);
  });
});

describe("reading a rating back", () => {
  it("reports whether a trip has been rated", async () => {
    const { passenger, tripId } = await setup(7);

    const before = await readJson(await req(`/api/trips/${tripId}/rating`, { headers: passenger.csrfHeaders() }));
    expect(before.rated).toBe(false);

    await rate(passenger, tripId, FIVE_STARS);

    const after = await readJson(await req(`/api/trips/${tripId}/rating`, { headers: passenger.csrfHeaders() }));
    expect(after.rated).toBe(true);
    expect(after.rating.overall).toBe(5);
  });
});

describe("a driver's reviews", () => {
  it("returns the summary, per-question averages, and only commented reviews", async () => {
    const { driver, passenger, tripId } = await setup(8);
    await rate(passenger, tripId, { ...FIVE_STARS, comment: "Smooth and on time" });

    // A second trip for the same driver, rated with no comment.
    const at2 = site(8);
    const passenger2 = await registerPassenger(uniqueEmail("rate-rev-p2"));
    const trip2 = await bookTrip(passenger2, at2);
    await completeTrip(driver.jar, trip2.id);
    await rate(passenger2, trip2.id, { courtesy: 3, safety: 3, punctuality: 3, communication: 3, cleanliness: 3 });

    const res = await req(`/api/drivers/${driver.driverId}/reviews`, { headers: passenger.csrfHeaders() });
    expect(res.status).toBe(200);
    const reviews = await readJson(res);

    expect(reviews.ratingCount).toBe(2);
    expect(reviews.rating).toBe(4); // (5.0 + 3.0) / 2
    expect(reviews.averages.courtesy).toBe(4); // (5 + 3) / 2
    // Only the commented one is listed; the bare-stars rating is folded into
    // the averages but doesn't clutter the comment list.
    expect(reviews.recent).toHaveLength(1);
    expect(reviews.recent[0].comment).toBe("Smooth and on time");
  });

  it("gives an empty, honest summary for a driver nobody has rated", async () => {
    const driver = await registerDriver(uniqueEmail("rate-none-d"), site(9));
    const passenger = await registerPassenger(uniqueEmail("rate-none-p"));

    const reviews = await readJson(
      await req(`/api/drivers/${driver.driverId}/reviews`, { headers: passenger.csrfHeaders() })
    );
    expect(reviews.rating).toBeNull();
    expect(reviews.ratingCount).toBe(0);
    expect(reviews.averages).toBeNull();
    expect(reviews.recent).toEqual([]);
  });
});
