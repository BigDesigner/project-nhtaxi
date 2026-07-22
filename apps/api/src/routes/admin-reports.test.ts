import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { hashPassword } from "../lib/password";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const ADMIN_PASSWORD = "correct horse battery staple";

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

async function createAdminSession() {
  const db = createDb(env.DB);
  const email = uniqueEmail("admin");
  await db.insert(usersTable).values({
    email,
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    firstName: "Ada",
    lastName: "Admin",
    role: "admin",
  });

  const jar = new CookieJar();
  const loginRes = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: ADMIN_PASSWORD }),
  });
  jar.applySetCookie(loginRes);
  return jar;
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
      phone: "+16035550060",
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
      phone: "+16035550061",
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

  const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return { jar, driverProfileId: dp!.id };
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

describe("GET /api/admin/reports/trips", () => {
  it("returns a trip + fare breakdown with driver/customer names, filterable by driver", async () => {
    const { pickup, dropoff } = region(44.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(uniqueEmail("report-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("report-passenger"));
    const completed = await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    const res = await req(`/api/admin/reports/trips?driverId=${driver.driverProfileId}`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(res.status).toBe(200);
    const rows = await readJson(res);

    const row = rows.find((r: any) => r.tripId === completed.id);
    expect(row).toBeTruthy();
    expect(row.driverName).toBe("Dan Driver");
    expect(row.customerName).toBe("Pat Passenger");
    expect(row.finalFare).toBeCloseTo(completed.finalFare);
    expect(row.status).toBe("TRIP_COMPLETED");
  });

  it("excludes trips outside the requested date range", async () => {
    const { pickup, dropoff } = region(45.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(
      uniqueEmail("report-driver-range"),
      pickup.pickupLat,
      pickup.pickupLng
    );
    const passengerJar = await registerPassenger(uniqueEmail("report-passenger-range"));
    await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await req(`/api/admin/reports/trips?driverId=${driver.driverProfileId}&from=${encodeURIComponent(future)}`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual([]);
  });

  it("exports a CSV file when format=csv is requested", async () => {
    const { pickup, dropoff } = region(46.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(uniqueEmail("report-driver-csv"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("report-passenger-csv"));
    const completed = await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    const res = await req(`/api/admin/reports/trips?driverId=${driver.driverProfileId}&format=csv`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    expect(res.headers.get("Content-Disposition")).toContain("attachment");

    const csv = await res.text();
    expect(csv.split("\r\n")[0]).toContain("tripId");
    expect(csv).toContain(completed.id);
  });
});

describe("GET /api/admin/reports/driver-earnings", () => {
  it("totals completed fares per driver, filterable to one driver", async () => {
    const { pickup, dropoff } = region(48.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(uniqueEmail("earn-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("earn-passenger"));
    const completed = await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    const res = await req(`/api/admin/reports/driver-earnings?driverId=${driver.driverProfileId}`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(res.status).toBe(200);
    const rows = await readJson(res);
    expect(rows).toHaveLength(1);
    expect(rows[0].driverId).toBe(driver.driverProfileId);
    expect(rows[0].driverName).toBe("Dan Driver");
    expect(rows[0].tripCount).toBe(1);
    expect(rows[0].totalEarnings).toBeCloseTo(completed.finalFare);
  });
});

describe("GET /api/admin/reports/financial-summary", () => {
  it("sums GNN income and gross fares over the period, with cash collected", async () => {
    const { pickup, dropoff } = region(49.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(uniqueEmail("fin-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("fin-passenger"));
    const completed = await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    // A cash collection so cashCollected is non-zero and traceable to this driver.
    const collectRes = await req(`/api/admin/drivers/${driver.driverProfileId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ amount: 20 }),
    });
    expect(collectRes.status).toBe(201);

    const res = await req(`/api/admin/reports/financial-summary`, { headers: { Cookie: adminJar.header() } });
    expect(res.status).toBe(200);
    const summary = await readJson(res);

    const row = summary.drivers.find((d: any) => d.driverId === driver.driverProfileId);
    expect(row).toBeTruthy();
    expect(row.completedTripCount).toBe(1);
    expect(row.grossFares).toBeCloseTo(completed.finalFare);
    expect(row.cashCollected).toBeCloseTo(20);
    // No admin-assigned commission and no closed/charged session in this flow,
    // so GNN's own cut on this driver is zero — the fare is the driver's money.
    expect(row.gnnRevenue).toBe(0);

    // Fleet totals include at least this driver's contribution (shared D1).
    expect(summary.grossFares).toBeGreaterThanOrEqual(completed.finalFare - 0.001);
    expect(summary.cashCollected).toBeGreaterThanOrEqual(20);
  });
});

describe("GET /api/admin/audit-logs", () => {
  it("records and lists a trip's audit trail, filterable by action", async () => {
    const { pickup, dropoff } = region(47.0);
    const adminJar = await createAdminSession();
    const driver = await registerAvailableNearbyDriver(uniqueEmail("audit-driver"), pickup.pickupLat, pickup.pickupLng);
    const passengerJar = await registerPassenger(uniqueEmail("audit-passenger"));
    const completed = await completeTrip(driver.jar, passengerJar, pickup, dropoff);

    const res = await req(`/api/admin/audit-logs?entity=trip&action=TRIP_STATUS_CHANGED`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(res.status).toBe(200);
    const rows = await readJson(res);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r: any) => r.action === "TRIP_STATUS_CHANGED")).toBe(true);
    expect(rows.some((r: any) => r.entityId === completed.id)).toBe(true);
  });
});
