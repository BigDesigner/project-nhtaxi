import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, driverCashCollectionsTable, driverProfilesTable, usersTable } from "@gnncab/db";
import {
  closeOpenSession,
  closeStaleSessions,
  computeDriverBalance,
  getOpenSession,
  openSession,
} from "./driver-sessions";
import { CookieJar, req, uniqueEmail } from "../test-utils/http";

/** Registers a real driver via the HTTP route (so the resulting driverId is
 * a genuine FK target) and returns its driver_profiles.id. */
async function registerDriver(email: string): Promise<string> {
  const jar = new CookieJar();
  const res = await req("/api/driver/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Dan",
      lastName: "Driver",
      email,
      phone: "+16035550070",
      password: "correct horse battery staple",
      acceptedAgreement: true, acceptedTermsVersion: "2026-07-20",
    }),
  });
  jar.applySetCookie(res);

  const db = createDb(env.DB);
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, email)).limit(1);
  const [dp] = await db.select({ id: driverProfilesTable.id }).from(driverProfilesTable).where(eq(driverProfilesTable.userId, user!.id)).limit(1);
  return dp!.id;
}

describe("lib/driver-sessions — usage-fee billing math", () => {
  it("computes duration and charge from explicit start/end timestamps", async () => {
    const db = createDb(env.DB);
    const driverId = await registerDriver(uniqueEmail("session-math"));

    const startedAt = new Date("2026-01-01T10:00:00Z");
    const endedAt = new Date("2026-01-01T11:20:00Z"); // 80 minutes later
    const perMinuteCents = 25;

    await openSession(db, driverId, startedAt);
    expect(await getOpenSession(db, driverId)).not.toBeNull();

    const closed = await closeOpenSession(db, driverId, endedAt, perMinuteCents, "OFFLINE_TOGGLE");
    expect(closed).not.toBeNull();
    expect(closed!.durationMinutes).toBe(80);
    expect(closed!.chargeCents).toBe(80 * perMinuteCents); // 2000 cents = $20, matches the user's own example
    expect(closed!.closedReason).toBe("OFFLINE_TOGGLE");
    expect(await getOpenSession(db, driverId)).toBeNull();
  });

  it("computeDriverBalance sums closed sessions + live accrual of an open one, minus collections", async () => {
    const db = createDb(env.DB);
    const driverId = await registerDriver(uniqueEmail("balance-math"));
    const perMinuteCents = 25;

    // A closed session: 40 minutes -> 1000 cents.
    await openSession(db, driverId, new Date("2026-02-01T09:00:00Z"));
    await closeOpenSession(db, driverId, new Date("2026-02-01T09:40:00Z"), perMinuteCents, "OFFLINE_TOGGLE");

    // A still-open session, started 10 minutes before `now`.
    const now = new Date("2026-02-01T12:00:00Z");
    await openSession(db, driverId, new Date("2026-02-01T11:50:00Z"));

    // A partial cash collection (collectedBy must be a real users.id — reuse
    // the driver's own user row since who exactly recorded it is irrelevant here).
    const [driverProfile] = await db
      .select({ userId: driverProfilesTable.userId })
      .from(driverProfilesTable)
      .where(eq(driverProfilesTable.id, driverId))
      .limit(1);
    await db
      .insert(driverCashCollectionsTable)
      .values({ driverId, amountCents: 500, collectedBy: driverProfile!.userId, collectedAt: now });

    const balance = await computeDriverBalance(db, driverId, now);
    expect(balance.usageFeeChargedCents).toBe(1000 + 10 * perMinuteCents); // closed + live accrual
    expect(balance.commissionChargedCents).toBe(0); // Faz 5c not landed yet
    expect(balance.totalCollectedCents).toBe(500);
    expect(balance.pendingBalanceCents).toBe(balance.totalChargedCents - 500);
    expect(balance.hasOpenSession).toBe(true);

    // D1 storage is shared across `it()`s in this file — close the open
    // session so it doesn't leak into the closeStaleSessions test below.
    await closeOpenSession(db, driverId, now, perMinuteCents, "OFFLINE_TOGGLE");
  });

  it("closeStaleSessions closes a session whose driver has gone quiet, but leaves a fresh one open", async () => {
    const db = createDb(env.DB);
    const staleDriverId = await registerDriver(uniqueEmail("stale-driver"));
    const freshDriverId = await registerDriver(uniqueEmail("fresh-driver"));

    const now = new Date("2026-03-01T15:00:00Z");
    const staleLastSeen = new Date("2026-03-01T13:00:00Z"); // 2h ago
    const freshLastSeen = new Date("2026-03-01T14:55:00Z"); // 5 min ago

    await db.update(driverProfilesTable).set({ lastSeen: staleLastSeen }).where(eq(driverProfilesTable.id, staleDriverId));
    await db.update(driverProfilesTable).set({ lastSeen: freshLastSeen }).where(eq(driverProfilesTable.id, freshDriverId));

    await openSession(db, staleDriverId, new Date("2026-03-01T12:00:00Z"));
    await openSession(db, freshDriverId, new Date("2026-03-01T14:50:00Z"));

    const closedCount = await closeStaleSessions(db, now, 60);
    expect(closedCount).toBe(1);

    expect(await getOpenSession(db, staleDriverId)).toBeNull();
    expect(await getOpenSession(db, freshDriverId)).not.toBeNull();

    const [staleDriver] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.id, staleDriverId)).limit(1);
    expect(staleDriver!.status).toBe("OFFLINE");
  });
});
