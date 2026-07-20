import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb, usersTable } from "@gnncab/db";
import { hashPassword } from "../lib/password";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const ADMIN_PASSWORD = "correct horse battery staple";

/** No self-service admin sign-up exists (by design, L15/L16) — bootstrap one
 * directly via DB, exactly like a real seed script would (plan gap #12). */
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
  return { jar, email };
}

async function registerPassenger(email: string) {
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550003",
      acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
    }),
  });
  return readJson(res);
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
      phone: "+16035550004",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);
  return { jar, body: await readJson(res) };
}

describe("admin — user management", () => {
  it("lists users and creates a user with any role directly (L16)", async () => {
    const { jar } = await createAdminSession();
    const passengerEmail = uniqueEmail("list-passenger");
    await registerPassenger(passengerEmail);

    const listRes = await req(`/api/admin/users?role=customer`, { headers: { Cookie: jar.header() } });
    expect(listRes.status).toBe(200);
    const list = await readJson(listRes);
    expect(list.some((u: any) => u.email === passengerEmail)).toBe(true);

    const createRes = await req("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({
        firstName: "Manual",
        lastName: "Driver",
        email: uniqueEmail("manual-driver"),
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
        role: "driver",
        isVerified: true,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await readJson(createRes);
    expect(created.role).toBe("driver");

    const driversRes = await req("/api/admin/drivers?isVerified=true", { headers: { Cookie: jar.header() } });
    const drivers = await readJson(driversRes);
    expect(drivers.some((d: any) => d.userId === created.id)).toBe(true);
  });

  it("reassigns a customer to driver and auto-creates the driver profile (L16)", async () => {
    const { jar } = await createAdminSession();
    const email = uniqueEmail("role-change");
    const passenger = await registerPassenger(email);

    const updateRes = await req(`/api/admin/users/${passenger.user.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ role: "driver" }),
    });
    expect(updateRes.status).toBe(200);
    expect((await readJson(updateRes)).role).toBe("driver");

    const driverRes = await req(`/api/admin/drivers`, { headers: { Cookie: jar.header() } });
    const drivers = await readJson(driverRes);
    const created = drivers.find((d: any) => d.userId === passenger.user.id);
    expect(created).toBeDefined();
    expect(created.status).toBe("OFFLINE");
    expect(created.isVerified).toBe(false);
  });

  it("is forbidden for non-admins", async () => {
    const jar = new CookieJar();
    const res0 = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        firstName: "Not",
        lastName: "Admin",
        email: uniqueEmail("not-admin"),
        phone: "+16035550005",
        acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
      }),
    });
    jar.applySetCookie(res0);

    const res = await req("/api/admin/users", { headers: { Cookie: jar.header() } });
    expect(res.status).toBe(403);
  });
});

describe("admin — driver verification & document review", () => {
  it("reviews a document (write-once once APPROVED) and can decrypt+download it", async () => {
    const { jar: adminJar } = await createAdminSession();
    const { jar: driverJar, body: driverAuth } = await registerDriver(uniqueEmail("doc-driver"));

    const fileContents = "%PDF-1.4 fake license contents for admin.test.ts";
    const uploadRes = await req("/api/driver/documents/license", {
      method: "POST",
      headers: { "Content-Type": "application/pdf", ...driverJar.csrfHeaders() },
      body: new TextEncoder().encode(fileContents),
    });
    expect(uploadRes.status).toBe(201);
    const document = await readJson(uploadRes);

    const driversRes = await req(`/api/admin/drivers`, { headers: { Cookie: adminJar.header() } });
    const driverEntry = (await readJson(driversRes)).find((d: any) => d.email === driverAuth.user.email);
    expect(driverEntry).toBeDefined();
    const driverId = driverEntry.id;

    const detailRes = await req(`/api/admin/drivers/${driverId}`, { headers: { Cookie: adminJar.header() } });
    const detail = await readJson(detailRes);
    expect(detail.documents).toHaveLength(1);
    expect(detail.documents[0].status).toBe("PENDING");

    const approveRes = await req(`/api/admin/drivers/${driverId}/documents/${document.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ status: "APPROVED" }),
    });
    expect(approveRes.status).toBe(200);
    expect((await readJson(approveRes)).status).toBe("APPROVED");

    // Write-once: a second review attempt must be rejected.
    const secondReviewRes = await req(`/api/admin/drivers/${driverId}/documents/${document.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ status: "REJECTED" }),
    });
    expect(secondReviewRes.status).toBe(409);

    // Admin can decrypt and download the original bytes.
    const fileRes = await req(`/api/admin/drivers/${driverId}/documents/${document.id}/file`, {
      headers: { Cookie: adminJar.header() },
    });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("Content-Type")).toBe("application/pdf");
    expect(await fileRes.text()).toBe(fileContents);

    // Approve the driver themselves too, and confirm they can now go AVAILABLE.
    const verifyRes = await req(`/api/admin/drivers/${driverId}/verify`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...adminJar.csrfHeaders() },
      body: JSON.stringify({ isVerified: true }),
    });
    expect(verifyRes.status).toBe(200);

    const goAvailableRes = await req("/api/driver/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...driverJar.csrfHeaders() },
      body: JSON.stringify({ status: "AVAILABLE" }),
    });
    expect(goAvailableRes.status).toBe(200);
  });
});

describe("admin — cities & pricing", () => {
  it("creates a city", async () => {
    const { jar } = await createAdminSession();
    const res = await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ name: "North Conway", state: "NH" }),
    });
    expect(res.status).toBe(201);
    const city = await readJson(res);
    expect(city.name).toBe("North Conway");
    expect(city.timezone).toBe("America/New_York");
  });

  it("refuses to add the same service area twice", async () => {
    const { jar } = await createAdminSession();
    const body = JSON.stringify({ name: "Portland", state: "ME" });

    const first = await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body,
    });
    expect(first.status).toBe(201);

    const second = await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body,
    });
    expect(second.status).toBe(409);
  });

  it("treats the name case-insensitively, but a different state is a different area", async () => {
    // "Portland" alone is genuinely ambiguous — ME and OR both exist — so
    // state is part of what makes two entries the same one.
    const { jar } = await createAdminSession();
    await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ name: "portsmouth", state: "NH" }),
    });

    const sameCasedDifferently = await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ name: "Portsmouth", state: "NH" }),
    });
    expect(sameCasedDifferently.status).toBe(409);

    const differentState = await req("/api/admin/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ name: "Portsmouth", state: "VA" }),
    });
    expect(differentState.status).toBe(201);
  });

  it("deletes a service area", async () => {
    const { jar } = await createAdminSession();
    const created = await readJson(
      await req("/api/admin/cities", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
        body: JSON.stringify({ name: "Conway", state: "NH" }),
      })
    );

    const res = await req(`/api/admin/cities/${created.id}`, {
      method: "DELETE",
      headers: jar.csrfHeaders(),
    });
    expect(res.status).toBe(200);

    const list = await readJson(await req("/api/admin/cities", { headers: jar.csrfHeaders() }));
    expect(list.some((c: { id: string }) => c.id === created.id)).toBe(false);
  });

  it("404s deleting a service area that doesn't exist", async () => {
    const { jar } = await createAdminSession();
    const res = await req("/api/admin/cities/00000000-0000-4000-8000-000000000000", {
      method: "DELETE",
      headers: jar.csrfHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it("reads default pricing then updates it (L8)", async () => {
    const { jar } = await createAdminSession();

    const getRes = await req("/api/admin/pricing", { headers: { Cookie: jar.header() } });
    const defaults = await readJson(getRes);
    expect(defaults.baseFare).toBe(2.5);
    expect(defaults.perMile).toBe(1.2);

    const updateRes = await req("/api/admin/pricing", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ baseFare: 3, perMile: 1.5 }),
    });
    expect(updateRes.status).toBe(200);
    const updated = await readJson(updateRes);
    expect(updated.baseFare).toBe(3);
    expect(updated.perMile).toBe(1.5);

    const getAgainRes = await req("/api/admin/pricing", { headers: { Cookie: jar.header() } });
    expect((await readJson(getAgainRes)).baseFare).toBe(3);
  });
});
