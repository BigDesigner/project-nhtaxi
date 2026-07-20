import { env } from "cloudflare:workers";
import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, refreshTokensTable, usersTable } from "@gnncab/db";
import { readJson, req, uniqueEmail } from "../test-utils/http";

const OLD_PASSWORD = "correct horse battery staple";
const NEW_PASSWORD = "a different long passphrase";

async function registerMobile(email: string): Promise<{ accessToken: string; refreshToken: string }> {
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550600",
      password: OLD_PASSWORD,
      acceptedTerms: true,
      acceptedTermsVersion: "2026-07-20",
      // Bearer tokens rather than cookies, so the test can assert on session
      // revocation directly.
      platform: "android",
    }),
  });
  const body = await readJson(res);
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

function change(accessToken: string, currentPassword: string, newPassword: string) {
  return req("/api/auth/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ currentPassword, newPassword }),
  });
}

function login(email: string, password: string) {
  return req("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, platform: "android" }),
  });
}

describe("changing your own password", () => {
  it("swaps the password and leaves the caller signed in", async () => {
    const email = uniqueEmail("pw-happy");
    const { accessToken } = await registerMobile(email);

    const res = await change(accessToken, OLD_PASSWORD, NEW_PASSWORD);
    expect(res.status).toBe(200);
    // A fresh session comes back, so the person changing their password isn't
    // logged out of the app they're standing in.
    expect((await readJson(res)).accessToken).toBeTruthy();

    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    expect((await login(email, OLD_PASSWORD)).status).toBe(401);
  });

  it("refuses without the current password", async () => {
    // The point of asking: a token on an unlocked phone must not be enough to
    // take someone's account off them.
    const email = uniqueEmail("pw-wrong-current");
    const { accessToken } = await registerMobile(email);

    const res = await change(accessToken, "not the right password", NEW_PASSWORD);
    expect(res.status).toBe(401);

    // And the old password still works — nothing was changed.
    expect((await login(email, OLD_PASSWORD)).status).toBe(200);
  });

  it("refuses an anonymous caller", async () => {
    const res = await req("/api/auth/password", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: OLD_PASSWORD, newPassword: NEW_PASSWORD }),
    });
    expect(res.status).toBe(401);
  });

  it("refuses a new password that is too short to be worth setting", async () => {
    const email = uniqueEmail("pw-short");
    const { accessToken } = await registerMobile(email);
    expect((await change(accessToken, OLD_PASSWORD, "short")).status).toBe(400);
  });

  it("refuses re-setting the same password", async () => {
    const email = uniqueEmail("pw-same");
    const { accessToken } = await registerMobile(email);
    expect((await change(accessToken, OLD_PASSWORD, OLD_PASSWORD)).status).toBe(400);
  });

  it("kills every other session", async () => {
    // The usual reason to change a password is that someone else might have
    // it. Leaving their sessions alive would defeat the whole exercise.
    const email = uniqueEmail("pw-sessions");
    const first = await registerMobile(email);

    // A second device signs in with the old password.
    const second = await readJson(await login(email, OLD_PASSWORD));
    expect(second.refreshToken).toBeTruthy();

    await change(first.accessToken, OLD_PASSWORD, NEW_PASSWORD);

    // The other device can no longer trade its refresh token for a session.
    const refreshed = await req("/api/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: second.refreshToken, platform: "android" }),
    });
    expect(refreshed.status).toBe(401);

    const db = createDb(env.DB);
    const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
    const live = await db
      .select({ id: refreshTokensTable.id })
      .from(refreshTokensTable)
      .where(and(eq(refreshTokensTable.userId, user!.id), isNull(refreshTokensTable.revokedAt)));

    // Only the session handed back by the change itself survives.
    expect(live).toHaveLength(1);
  });
});
