import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, usersTable } from "@gnncab/db";
import { CSRF_COOKIE_NAME } from "../lib/auth-cookie";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const BASE_REGISTER_BODY = {
  firstName: "Test",
  lastName: "User",
  phone: "+16035550000",
  password: "correct horse battery staple",
  // Registration is refused without these — there is no implicit consent.
  acceptedTerms: true as const,
  acceptedTermsVersion: "2026-07-20",
};

describe("auth — web (cookie) flow", () => {
  it("registers, reads /me, refreshes, and logs out", async () => {
    const jar = new CookieJar();
    const email = uniqueEmail();

    const registerRes = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email }),
    });
    expect(registerRes.status).toBe(201);
    jar.applySetCookie(registerRes);
    const registerBody = await readJson(registerRes);
    expect(registerBody.accessToken).toBeNull();
    expect(registerBody.refreshToken).toBeNull();
    expect(registerBody.user.email).toBe(email);
    expect(registerBody.user.role).toBe("customer");

    const meRes = await req("/api/auth/me", { headers: { Cookie: jar.header() } });
    expect(meRes.status).toBe(200);
    expect((await readJson(meRes)).email).toBe(email);

    const oldRefreshCookie = jar.get("gnncab_refresh");

    // /refresh is an unsafe method and a session cookie already exists, so
    // it requires the CSRF header (double-submit) just like any other
    // cookie-authenticated state change.
    const refreshRes = await req("/api/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: jar.header(),
        "X-CSRF-Token": jar.get(CSRF_COOKIE_NAME) ?? "",
      },
      body: "{}",
    });
    expect(refreshRes.status).toBe(200);
    jar.applySetCookie(refreshRes);
    expect(jar.get("gnncab_refresh")).not.toBe(oldRefreshCookie);

    // Old refresh cookie was rotated out — reusing it must now fail.
    const reuseRes = await req("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: `gnncab_refresh=${oldRefreshCookie}` },
      body: "{}",
    });
    expect(reuseRes.status).toBe(401);

    const logoutRes = await req("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: jar.header(), "X-CSRF-Token": jar.get(CSRF_COOKIE_NAME) ?? "" },
    });
    expect(logoutRes.status).toBe(200);

    // Logout revoked the (rotated) refresh cookie — refreshing again fails
    // (CSRF header included so the request reaches the token check itself,
    // rather than being rejected earlier by the CSRF middleware).
    const afterLogoutRefresh = await req("/api/auth/refresh", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: jar.header(),
        "X-CSRF-Token": jar.get(CSRF_COOKIE_NAME) ?? "",
      },
      body: "{}",
    });
    expect(afterLogoutRefresh.status).toBe(401);
  });

  it("rejects an unsafe request from an existing session without a CSRF header", async () => {
    const jar = new CookieJar();
    const registerRes = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email: uniqueEmail() }),
    });
    jar.applySetCookie(registerRes);

    const res = await req("/api/auth/logout", {
      method: "POST",
      headers: { Cookie: jar.header() }, // no X-CSRF-Token
    });
    expect(res.status).toBe(403);
  });

  it("rejects duplicate registration", async () => {
    const email = uniqueEmail();
    const body = JSON.stringify({ ...BASE_REGISTER_BODY, email });
    const headers = { "Content-Type": "application/json" };

    const first = await req("/api/auth/register", { method: "POST", headers, body });
    expect(first.status).toBe(201);

    const second = await req("/api/auth/register", { method: "POST", headers, body });
    expect(second.status).toBe(409);
  });

  it("rejects a register request with no Content-Type header (regression: must not silently skip validation)", async () => {
    // @hono/zod-openapi only runs the zod validator when the body is marked
    // `required` or the Content-Type is recognized as JSON — otherwise it
    // silently substitutes an unvalidated `{}`. registerRoute sets
    // `body.required: true` specifically to prevent that; this pins it.
    const res = await req("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email: uniqueEmail() }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects login with the wrong password", async () => {
    const email = uniqueEmail();
    const headers = { "Content-Type": "application/json" };
    await req("/api/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email }),
    });

    const res = await req("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "wrong password" }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects login for a deactivated account", async () => {
    const email = uniqueEmail();
    const headers = { "Content-Type": "application/json" };
    await req("/api/auth/register", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email }),
    });

    const db = createDb(env.DB);
    await db.update(usersTable).set({ isActive: false }).where(eq(usersTable.email, email));

    const res = await req("/api/auth/login", {
      method: "POST",
      headers,
      body: JSON.stringify({ email, acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: BASE_REGISTER_BODY.password }),
    });
    expect(res.status).toBe(403);
  });
});

describe("auth — mobile (Bearer) flow", () => {
  it("returns tokens in the body and never sets cookies", async () => {
    const email = uniqueEmail();
    const registerRes = await req("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...BASE_REGISTER_BODY, email, platform: "ios" }),
    });
    expect(registerRes.status).toBe(201);
    expect(registerRes.headers.getSetCookie()).toHaveLength(0);

    const body = await readJson(registerRes);
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");

    const meRes = await req("/api/auth/me", { headers: { Authorization: `Bearer ${body.accessToken}` } });
    expect(meRes.status).toBe(200);
    expect((await readJson(meRes)).email).toBe(email);

    // No cookie exists at all — CSRF must not block a Bearer-authenticated
    // unsafe request.
    const refreshRes = await req("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: body.refreshToken, platform: "ios" }),
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = await readJson(refreshRes);
    expect(typeof refreshed.accessToken).toBe("string");
    expect(refreshed.refreshToken).not.toBe(body.refreshToken);
  });
});
