import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { hashPassword } from "../lib/password";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const ADMIN_PASSWORD = "correct horse battery staple";
const PICKUP = { pickupLat: 44.05, pickupLng: -71.12, pickupAddress: "Boston Airport" };

async function createAdminSession() {
  const db = createDb(env.DB);
  const email = uniqueEmail("assign-admin");
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

async function registerAvailableDriver(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550090",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  await db.update(driverProfilesTable).set({ isVerified: true, status: "AVAILABLE" }).where(eq(driverProfilesTable.userId, user!.id));
  const [dp] = await db.select({ id: driverProfilesTable.id }).from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return { jar, driverId: dp!.id };
}

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firstName: "Pat", lastName: "Passenger", email, phone: "+16035550091", acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple" }),
  });
  jar.applySetCookie(res);
  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  return user!.id;
}

describe("POST /api/admin/trips — admin-assigned trips", () => {
  it("assigns a guest booking to an available driver, reserving them and disclosing the commission rate", async () => {
    const adminJar = await createAdminSession();
    const { driverId } = await registerAvailableDriver(uniqueEmail("assign-guest-driver"));

    const res = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId, ...PICKUP, guestName: "Walk-in Wendy", guestPhone: "+16035559999" }),
    });
    expect(res.status).toBe(201);
    const trip = await readJson(res);
    expect(trip.origin).toBe("ADMIN_ASSIGNED");
    expect(trip.status).toBe("DRIVER_ASSIGNED");
    expect(trip.customerId).toBeNull();
    expect(trip.guestName).toBe("Walk-in Wendy");
    expect(trip.commissionPercent).toBe(20); // default from pricing_config

    const db = createDb(env.DB);
    const [driver] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, driverId)).limit(1);
    expect(driver!.status).toBe("RESERVED");
  });

  it("rejects assigning to a driver who is not AVAILABLE", async () => {
    const adminJar = await createAdminSession();
    const email = uniqueEmail("assign-busy-driver");
    const jar = new CookieJar();
    const res = await req("/api/driver/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Dan",
        lastName: "Driver",
        email,
        phone: "+16035550092",
        password: "correct horse battery staple",
        acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
      }),
    });
    jar.applySetCookie(res);
    const db = createDb(env.DB);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const [dp] = await db.select({ id: driverProfilesTable.id }).from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
    // isVerified true but status stays OFFLINE (never toggled available)

    const assignRes = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId: dp!.id, ...PICKUP, guestName: "Walk-in", guestPhone: "+16035559998" }),
    });
    expect(assignRes.status).toBe(409);
  });

  it("rejects a request with both customerId and guest info, or neither", async () => {
    const adminJar = await createAdminSession();
    const { driverId } = await registerAvailableDriver(uniqueEmail("assign-validation-driver"));
    const customerId = await registerPassenger(uniqueEmail("assign-validation-passenger"));

    const neitherRes = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId, ...PICKUP }),
    });
    expect(neitherRes.status).toBe(400);

    const bothRes = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId, ...PICKUP, customerId, guestName: "X", guestPhone: "+16035550000" }),
    });
    expect(bothRes.status).toBe(400);
  });

  it("runs a full admin-assigned trip to completion: driver supplies dropoff at start, commission is charged only on this trip type", async () => {
    const adminJar = await createAdminSession();
    const { jar: driverJar, driverId } = await registerAvailableDriver(uniqueEmail("assign-full-driver"));
    const customerId = await registerPassenger(uniqueEmail("assign-full-passenger"));

    const assignRes = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId, ...PICKUP, customerId }),
    });
    expect(assignRes.status).toBe(201);
    const trip = await readJson(assignRes);
    expect(trip.dropoffLat).toBeNull();
    expect(trip.estimatedFare).toBeNull();

    for (const status of ["DRIVER_ACCEPTED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED"]) {
      const stepRes = await req(`/api/trips/${trip.id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
        body: JSON.stringify({ status }),
      });
      expect(stepRes.status).toBe(200);
    }

    const startNoDropoffRes = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "TRIP_STARTED" }),
    });
    expect(startNoDropoffRes.status).toBe(400);

    const startRes = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({
        status: "TRIP_STARTED",
        dropoffLat: 44.09,
        dropoffLng: -71.18,
        dropoffAddress: "Mountain Rd",
      }),
    });
    expect(startRes.status).toBe(200);
    const started = await readJson(startRes);
    expect(started.dropoffAddress).toBe("Mountain Rd");
    expect(started.estimatedFare).toBeGreaterThan(0);

    const completeRes = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "TRIP_COMPLETED" }),
    });
    expect(completeRes.status).toBe(200);
    const completed = await readJson(completeRes);
    expect(completed.finalFare).toBeCloseTo(started.estimatedFare);

    const commissionsRes = await req(`/api/admin/reports/driver-commissions?driverId=${driverId}`, {
      headers: { Cookie: adminJar.header() },
    });
    const commissions = await readJson(commissionsRes);
    expect(commissions).toHaveLength(1);
    expect(commissions[0].tripId).toBe(trip.id);
    expect(commissions[0].commission).toBeCloseTo((completed.finalFare * 20) / 100);

    const balancesRes = await req("/api/admin/reports/driver-balances", { headers: { Cookie: adminJar.header() } });
    const balances = await readJson(balancesRes);
    const row = balances.find((r: any) => r.driverId === driverId);
    expect(row.commissionCharged).toBeCloseTo(commissions[0].commission);
  });

  it("reassigns a trip to a different driver after a rejection", async () => {
    const adminJar = await createAdminSession();
    const { jar: driverAJar, driverId: driverAId } = await registerAvailableDriver(uniqueEmail("reassign-a"));
    const { driverId: driverBId } = await registerAvailableDriver(uniqueEmail("reassign-b"));

    const assignRes = await req("/api/admin/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId: driverAId, ...PICKUP, guestName: "Guest", guestPhone: "+16035550001" }),
    });
    const trip = await readJson(assignRes);

    const rejectRes = await req(`/api/trips/${trip.id}/status`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverAJar.csrfHeaders() },
      body: JSON.stringify({ status: "DRIVER_REJECTED" }),
    });
    expect(rejectRes.status).toBe(200);

    const reassignRes = await req(`/api/admin/trips/${trip.id}/reassign`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ driverId: driverBId }),
    });
    expect(reassignRes.status).toBe(200);
    const reassigned = await readJson(reassignRes);
    expect(reassigned.driverId).toBe(driverBId);
    expect(reassigned.status).toBe("DRIVER_ASSIGNED");

    const db = createDb(env.DB);
    const [driverA] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, driverAId)).limit(1);
    const [driverB] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, driverBId)).limit(1);
    expect(driverA!.status).toBe("AVAILABLE");
    expect(driverB!.status).toBe("RESERVED");
  });
});
