import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, pushTokensTable, usersTable } from "@gnncab/db";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550100",
      password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

describe("push-token registration", () => {
  it("registers a device token for the authenticated user", async () => {
    const email = uniqueEmail("push-register");
    const jar = await registerPassenger(email);

    const res = await req("/api/push-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ token: "fcm-token-abc123", platform: "android" }),
    });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ status: "ok" });

    const db = createDb(env.DB);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const [row] = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, "fcm-token-abc123")).limit(1);
    expect(row).toBeTruthy();
    expect(row!.userId).toBe(user!.id);
    expect(row!.platform).toBe("android");
  });

  it("re-registering the same token transfers ownership to whoever is now authenticated", async () => {
    const firstJar = await registerPassenger(uniqueEmail("push-owner-a"));
    const secondJar = await registerPassenger(uniqueEmail("push-owner-b"));

    await req("/api/push-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...firstJar.csrfHeaders() },
      body: JSON.stringify({ token: "shared-device-token", platform: "ios" }),
    });

    const res = await req("/api/push-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...secondJar.csrfHeaders() },
      body: JSON.stringify({ token: "shared-device-token", platform: "ios" }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, "shared-device-token"));
    expect(rows).toHaveLength(1); // upserted, not duplicated
  });

  it("unregisters a token belonging to the caller, rejects one that doesn't", async () => {
    const ownerJar = await registerPassenger(uniqueEmail("push-unregister-owner"));
    const otherJar = await registerPassenger(uniqueEmail("push-unregister-other"));

    await req("/api/push-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...ownerJar.csrfHeaders() },
      body: JSON.stringify({ token: "token-to-remove", platform: "android" }),
    });

    const wrongOwnerRes = await req("/api/push-tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...otherJar.csrfHeaders() },
      body: JSON.stringify({ token: "token-to-remove" }),
    });
    expect(wrongOwnerRes.status).toBe(404);

    const res = await req("/api/push-tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json", ...ownerJar.csrfHeaders() },
      body: JSON.stringify({ token: "token-to-remove" }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, "token-to-remove"));
    expect(rows).toHaveLength(0);
  });
});
