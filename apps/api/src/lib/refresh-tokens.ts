import { and, eq, isNull } from "drizzle-orm";
import { refreshTokensTable, type Database } from "@gnncab/db";

// L11 — 30-day refresh token, rotated on every use, revocable per device.
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateRawToken(): string {
  return base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)));
}

export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

export async function issueRefreshToken(
  db: Database,
  userId: string,
  deviceInfo?: string
): Promise<IssuedRefreshToken> {
  const rawToken = generateRawToken();
  const tokenHash = await sha256Hex(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);

  await db.insert(refreshTokensTable).values({
    userId,
    tokenHash,
    deviceInfo: deviceInfo ?? null,
    expiresAt,
  });

  return { rawToken, expiresAt };
}

/**
 * Verifies the raw refresh token, revokes it, and issues a fresh one for the
 * same user/device (rotation). Returns null for an unknown, expired, or
 * already-revoked token — callers must treat that as "log the user out".
 */
export async function rotateRefreshToken(
  db: Database,
  rawToken: string
): Promise<(IssuedRefreshToken & { userId: string }) | null> {
  const tokenHash = await sha256Hex(rawToken);

  const [existing] = await db
    .select()
    .from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.tokenHash, tokenHash), isNull(refreshTokensTable.revokedAt)))
    .limit(1);

  if (!existing || existing.expiresAt.getTime() <= Date.now()) return null;

  const now = new Date();
  await db.update(refreshTokensTable).set({ revokedAt: now }).where(eq(refreshTokensTable.id, existing.id));

  const next = await issueRefreshToken(db, existing.userId, existing.deviceInfo ?? undefined);
  return { userId: existing.userId, ...next };
}

/** Revokes the token and returns the owning userId (or null if it was already unknown/revoked) — used to attribute the LOGOUT audit entry. */
export async function revokeRefreshToken(db: Database, rawToken: string): Promise<string | null> {
  const tokenHash = await sha256Hex(rawToken);

  const [existing] = await db
    .select({ id: refreshTokensTable.id, userId: refreshTokensTable.userId })
    .from(refreshTokensTable)
    .where(and(eq(refreshTokensTable.tokenHash, tokenHash), isNull(refreshTokensTable.revokedAt)))
    .limit(1);

  if (!existing) return null;

  await db.update(refreshTokensTable).set({ revokedAt: new Date() }).where(eq(refreshTokensTable.id, existing.id));
  return existing.userId;
}
