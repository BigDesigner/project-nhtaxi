import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverProfilesTable, usersTable } from "@gnncab/db";
import { hashPassword } from "../lib/password";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

/**
 * The owner-operator account: `role` stays `"driver"` so every existing
 * driver-only check keeps working unmodified, and `isAdmin` is what
 * separately unlocks the admin panel on top of that. There is no API path
 * that sets `isAdmin` — see the schema comment on `users.isAdmin` for why —
 * so these tests create it directly via the database, exactly like the
 * existing admin-bootstrap tests do for `role: "admin"`.
 */

const PASSWORD = "correct horse battery staple";
const TERMS = { acceptedTermsVersion: "2026-07-20" };

async function loginAs(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD, platform: "web" }),
  });
  jar.applySetCookie(res);
  return jar;
}

async function createDualRoleAccount(email: string) {
  const db = createDb(env.DB);
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      firstName: "Owner",
      lastName: "Operator",
      role: "driver",
      isAdmin: true,
    })
    .returning();
  await db.insert(driverProfilesTable).values({ userId: user!.id, status: "OFFLINE", isVerified: true });
  return loginAs(email);
}

async function createOrdinaryDriver(email: string) {
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550777",
      password: PASSWORD,
      acceptedAgreement: true,
      ...TERMS,
    }),
  });
  const jar = new CookieJar();
  jar.applySetCookie(res);
  return jar;
}

describe("isAdmin grants admin access to a driver-role account", () => {
  it("lets a driver with isAdmin: true reach an admin-only endpoint", async () => {
    const jar = await createDualRoleAccount(uniqueEmail("dualrole-admin"));
    const res = await req("/api/admin/cities", { headers: jar.csrfHeaders() });
    expect(res.status).toBe(200);
  });

  it("still refuses an ordinary driver with no isAdmin flag", async () => {
    const jar = await createOrdinaryDriver(uniqueEmail("dualrole-plain"));
    const res = await req("/api/admin/cities", { headers: jar.csrfHeaders() });
    expect(res.status).toBe(403);
  });

  it("does not disturb the driver side — the same dual-role account still works as an ordinary driver", async () => {
    // The whole point of keeping role === "driver" rather than inventing a
    // combined role value: every driver-only check treats this account
    // exactly like any other driver, with zero special-casing.
    const jar = await createDualRoleAccount(uniqueEmail("dualrole-stillDriver"));
    const res = await req("/api/driver/profile", { headers: jar.csrfHeaders() });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.status).toBeDefined();
  });
});

describe("no API path can mint or promote to admin", () => {
  it("refuses to create a new admin user", async () => {
    const jar = await createDualRoleAccount(uniqueEmail("dualrole-creator"));
    const res = await req("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({
        firstName: "New",
        lastName: "Admin",
        email: uniqueEmail("would-be-admin"),
        password: PASSWORD,
        role: "admin",
      }),
    });
    expect(res.status).toBe(403);
  });

  it("refuses to promote an existing user to admin", async () => {
    const admin = await createDualRoleAccount(uniqueEmail("dualrole-promoter"));
    const targetEmail = uniqueEmail("target-driver");
    await createOrdinaryDriver(targetEmail);

    const db = createDb(env.DB);
    const [target] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, targetEmail)).limit(1);

    const res = await req(`/api/admin/users/${target!.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...admin.csrfHeaders() },
      body: JSON.stringify({ role: "admin" }),
    });
    expect(res.status).toBe(403);

    const [row] = await db.select({ role: usersTable.role }).from(usersTable).where(eq(usersTable.id, target!.id)).limit(1);
    expect(row!.role).toBe("driver");
  });
});
