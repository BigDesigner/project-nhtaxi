import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb, usersTable } from "@gnncab/db";
import { issueRefreshToken, revokeRefreshToken, rotateRefreshToken } from "./refresh-tokens";

describe("refresh tokens", () => {
  it("issues, rotates, and revokes a refresh token", async () => {
    const db = createDb(env.DB);
    const [user] = await db
      .insert(usersTable)
      .values({
        email: `test-${crypto.randomUUID()}@example.com`,
        passwordHash: "unused-in-this-test",
        firstName: "Test",
        lastName: "User",
        role: "customer",
      })
      .returning();

    const issued = await issueRefreshToken(db, user!.id, "test-device");
    expect(issued.rawToken).toBeTruthy();

    const rotated = await rotateRefreshToken(db, issued.rawToken);
    expect(rotated?.userId).toBe(user!.id);
    expect(rotated?.rawToken).not.toBe(issued.rawToken);

    // The old token was revoked by rotation — reusing it must fail.
    expect(await rotateRefreshToken(db, issued.rawToken)).toBeNull();

    // The new token works until explicitly revoked, and revoking returns
    // the owning userId (used to attribute the LOGOUT audit entry).
    expect(await revokeRefreshToken(db, rotated!.rawToken)).toBe(user!.id);
    expect(await rotateRefreshToken(db, rotated!.rawToken)).toBeNull();
  });

  it("rejects an unknown token", async () => {
    const db = createDb(env.DB);
    expect(await rotateRefreshToken(db, "not-a-real-token")).toBeNull();
    expect(await revokeRefreshToken(db, "not-a-real-token")).toBeNull();
  });
});
