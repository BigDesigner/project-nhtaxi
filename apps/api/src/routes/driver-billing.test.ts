import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { hashPassword } from "../lib/password";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const ADMIN_PASSWORD = "correct horse battery staple";

async function createAdminSession() {
  const db = createDb(env.DB);
  const email = uniqueEmail("billing-admin");
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

async function registerDriver(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550080",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db.update(driverProfilesTable).set({ isVerified: true }).where(eq(driverProfilesTable.userId, user!.id));
  const [dp] = await db.select({ id: driverProfilesTable.id }).from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return { jar, driverId: dp!.id };
}

describe("driver online/offline toggle opens and closes a billable session", () => {
  it("creates a session on AVAILABLE and closes it on OFFLINE, visible via the driver's own /sessions", async () => {
    const { jar } = await registerDriver(uniqueEmail("toggle-driver"));

    const goOnline = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });
    expect(goOnline.status).toBe(200);

    const goOffline = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ status: "OFFLINE" }),
    });
    expect(goOffline.status).toBe(200);

    const sessionsRes = await req("/api/driver/sessions", { headers: { Cookie: jar.header() } });
    expect(sessionsRes.status).toBe(200);
    const sessions = await readJson(sessionsRes);
    expect(sessions).toHaveLength(1);
    expect(sessions[0].endedAt).not.toBeNull();
    expect(sessions[0].closedReason).toBe("OFFLINE_TOGGLE");
    expect(sessions[0].charge).toBeGreaterThanOrEqual(0);
  });

  it("does not open a new session for a non-OFFLINE-boundary update (vehicle info only)", async () => {
    const { jar } = await registerDriver(uniqueEmail("no-toggle-driver"));

    const res = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ vehicleColor: "Blue" }),
    });
    expect(res.status).toBe(200);

    const sessionsRes = await req("/api/driver/sessions", { headers: { Cookie: jar.header() } });
    expect(await readJson(sessionsRes)).toHaveLength(0);
  });
});

describe("admin cash collections + balance/collections reports", () => {
  it("recording a collection reduces the driver's pending balance and shows up in both the driver's and admin's views", async () => {
    const adminJar = await createAdminSession();
    const { jar: driverJar, driverId } = await registerDriver(uniqueEmail("collect-driver"));

    await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });
    await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "OFFLINE" }),
    });

    const ownBalanceBefore = await readJson(await req("/api/driver/balance", { headers: { Cookie: driverJar.header() } }));

    const collectRes = await req(`/api/admin/drivers/${driverId}/collections`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ amount: 5, notes: "partial payment" }),
    });
    expect(collectRes.status).toBe(201);
    const collection = await readJson(collectRes);
    expect(collection.driverId).toBe(driverId);
    expect(collection.amount).toBe(5);
    expect(collection.collectedByName).toBe("Ada Admin");

    const ownBalanceAfter = await readJson(await req("/api/driver/balance", { headers: { Cookie: driverJar.header() } }));
    expect(ownBalanceAfter.totalCollected).toBe(5);
    expect(ownBalanceAfter.pendingBalance).toBeCloseTo(ownBalanceBefore.totalCharged - 5);

    const balancesRes = await req("/api/admin/reports/driver-balances", { headers: { Cookie: adminJar.header() } });
    const balances = await readJson(balancesRes);
    const row = balances.find((r: any) => r.driverId === driverId);
    expect(row).toBeTruthy();
    expect(row.totalCollected).toBe(5);

    const collectionsRes = await req(`/api/admin/reports/driver-collections?driverId=${driverId}`, {
      headers: { Cookie: adminJar.header() },
    });
    const collections = await readJson(collectionsRes);
    expect(collections).toHaveLength(1);
    expect(collections[0].amount).toBe(5);

    const csvRes = await req(`/api/admin/reports/driver-collections?driverId=${driverId}&format=csv`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(csvRes.headers.get("Content-Type")).toContain("text/csv");
    const csv = await csvRes.text();
    expect(csv).toContain(collection.id);
  });

  it("force-closes a driver's stuck open session and rejects when there's nothing to close", async () => {
    const adminJar = await createAdminSession();
    const { jar: driverJar, driverId } = await registerDriver(uniqueEmail("stuck-driver"));

    await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });

    const closeRes = await req(`/api/admin/drivers/${driverId}/close-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
    });
    expect(closeRes.status).toBe(200);
    const closed = await readJson(closeRes);
    expect(closed.closedReason).toBe("ADMIN_FORCE_CLOSE");
    expect(closed.endedAt).not.toBeNull();

    const noSessionRes = await req(`/api/admin/drivers/${driverId}/close-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
    });
    expect(noSessionRes.status).toBe(404);
  });
});

describe("admin pricing config — Faz 5b fields are independently editable", () => {
  it("updating just the ride fare leaves the usage-fee/commission rate untouched, and vice versa", async () => {
    const adminJar = await createAdminSession();

    const firstUpdate = await req("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ baseFare: 3, perMile: 1.5 }),
    });
    expect(firstUpdate.status).toBe(200);
    const afterFirst = await readJson(firstUpdate);
    expect(afterFirst.baseFare).toBe(3);
    expect(afterFirst.driverUsagePerMinute).toBe(0.25); // default preserved

    const secondUpdate = await req("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ baseFare: 3, perMile: 1.5, driverUsagePerMinute: 0.3, driverCommissionPercent: 30 }),
    });
    const afterSecond = await readJson(secondUpdate);
    expect(afterSecond.baseFare).toBe(3); // untouched by this call, still previous value
    expect(afterSecond.driverUsagePerMinute).toBe(0.3);
    expect(afterSecond.driverCommissionPercent).toBe(30);
  });
});

describe("cash-only payment restriction (Faz 5b)", () => {
  it("rejects a trip request with a non-cash payment method", async () => {
    const passengerJar = new CookieJar();
    const registerRes = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Pat",
        lastName: "Passenger",
        email: uniqueEmail("cash-only-passenger"),
        phone: "+16035550081",
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
      }),
    });
    passengerJar.applySetCookie(registerRes);

    const res = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...passengerJar.csrfHeaders() },
      body: JSON.stringify({
        pickupLat: 44.05,
        pickupLng: -71.12,
        pickupAddress: "Main St",
        dropoffLat: 44.09,
        dropoffLng: -71.18,
        dropoffAddress: "Mountain Rd",
        paymentMethod: "card",
      }),
    });
    expect(res.status).toBe(400);
  });
});
