import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const BASE_DRIVER_BODY = {
  firstName: "Driver",
  lastName: "Test",
  phone: "+16035550000",
  password: "correct horse battery staple",
  vehicleMake: "Toyota",
  vehicleModel: "Camry",
  vehicleYear: 2020,
  vehicleColor: "Black",
  vehiclePlate: "NH-1234",
  licenseNumber: "D123456",
  acceptedAgreement: true as const,
};

async function registerDriver(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...BASE_DRIVER_BODY, email }),
  });
  jar.applySetCookie(res);
  return { res, jar, body: await readJson(res) };
}

describe("driver self sign-up & profile", () => {
  it("registers a driver (OFFLINE, unverified) and exposes their own profile", async () => {
    const email = uniqueEmail("driver");
    const { res, jar, body } = await registerDriver(email);

    expect(res.status).toBe(201);
    expect(body.user.role).toBe("driver");
    expect(body.accessToken).toBeNull(); // web platform default

    const profileRes = await req("/api/driver/profile", { headers: { Cookie: jar.header() } });
    expect(profileRes.status).toBe(200);
    const profile = await readJson(profileRes);
    expect(profile.status).toBe("OFFLINE");
    expect(profile.isVerified).toBe(false);
    expect(profile.vehiclePlate).toBe("NH-1234");
  });

  it("refuses to go AVAILABLE before admin verification, allows it after", async () => {
    const email = uniqueEmail("driver");
    const { jar } = await registerDriver(email);

    const blocked = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });
    expect(blocked.status).toBe(403);

    // The actual approval route lives in admin.ts (covered by admin.test.ts)
    // — flip it directly here so this test only asserts the profile-update gate.
    const db = createDb(env.DB);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    await db.update(driverProfilesTable).set({ isVerified: true }).where(eq(driverProfilesTable.userId, user!.id));

    const allowed = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });
    expect(allowed.status).toBe(200);
    expect((await readJson(allowed)).status).toBe("AVAILABLE");
  });

  it("uploads a document (PENDING) and lists it back without exposing bytes", async () => {
    const email = uniqueEmail("driver");
    const { jar } = await registerDriver(email);

    const fileBytes = new TextEncoder().encode("%PDF-1.4 fake license bytes");
    const uploadRes = await req("/api/driver/documents/license", {
      method: "POST",
      headers: { "Content-Type": "application/pdf", ...jar.csrfHeaders() },
      body: fileBytes,
    });
    expect(uploadRes.status).toBe(201);
    const uploaded = await readJson(uploadRes);
    expect(uploaded.type).toBe("license");
    expect(uploaded.status).toBe("PENDING");
    expect(uploaded.r2Key).toBeUndefined(); // never exposed to the client

    const listRes = await req("/api/driver/documents", { headers: { Cookie: jar.header() } });
    const list = await readJson(listRes);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(uploaded.id);
  });

  it("rejects an empty upload", async () => {
    const email = uniqueEmail("driver");
    const { jar } = await registerDriver(email);

    const res = await req("/api/driver/documents/photo", {
      method: "POST",
      headers: { "Content-Type": "image/jpeg", ...jar.csrfHeaders() },
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
  });

  it("requires authentication for /driver/profile", async () => {
    const res = await req("/api/driver/profile");
    expect(res.status).toBe(401);
  });
});
