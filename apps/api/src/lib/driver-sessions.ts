import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  driverCashCollectionsTable,
  driverProfilesTable,
  driverSessionsTable,
  driverTripCommissionsTable,
  pricingConfigTable,
  type Database,
  type DriverSession,
  type SessionCloseReason,
} from "@gnncab/db";

// Faz 5b — GNN LLC's own revenue model: drivers pay per minute of active
// (non-OFFLINE) app time, regardless of trips completed. Sessions open/close
// only on the OFFLINE<->non-OFFLINE toggle (driver_profile.ts) or the
// stale-session sweep below — trip activity never touches them.

const DEFAULT_PER_MINUTE_CENTS = 25;
const DEFAULT_COMMISSION_PERCENT = 20;
export const STALE_SESSION_TIMEOUT_MINUTES = 60;

export interface DriverUsageRates {
  perMinuteCents: number;
  commissionPercent: number;
}

export async function getDriverUsageRates(db: Database): Promise<DriverUsageRates> {
  const [row] = await db
    .select({
      perMinuteCents: pricingConfigTable.driverUsagePerMinuteCents,
      commissionPercent: pricingConfigTable.driverCommissionPercent,
    })
    .from(pricingConfigTable)
    .where(isNull(pricingConfigTable.cityId))
    .limit(1);

  return {
    perMinuteCents: row?.perMinuteCents ?? DEFAULT_PER_MINUTE_CENTS,
    commissionPercent: row?.commissionPercent ?? DEFAULT_COMMISSION_PERCENT,
  };
}

export async function openSession(db: Database, driverId: string, now: Date = new Date()): Promise<DriverSession> {
  const [session] = await db.insert(driverSessionsTable).values({ driverId, startedAt: now }).returning();
  if (!session) throw new Error("Insert into driver_sessions returned no row");
  return session;
}

export async function getOpenSession(db: Database, driverId: string): Promise<DriverSession | null> {
  const [session] = await db
    .select()
    .from(driverSessionsTable)
    .where(and(eq(driverSessionsTable.driverId, driverId), isNull(driverSessionsTable.endedAt)))
    .limit(1);
  return session ?? null;
}

function computeDurationMinutes(startedAt: Date, endedAt: Date): number {
  return Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 60_000));
}

/** Charge an ongoing (not-yet-closed) session has accrued as of `now` — used
 * by balance reports so an admin/driver sees an up-to-the-minute figure
 * without needing to wait for the session to actually close. */
export function computeLiveChargeCents(session: { startedAt: Date }, perMinuteCents: number, now: Date = new Date()): number {
  return computeDurationMinutes(session.startedAt, now) * perMinuteCents;
}

async function closeSessionRow(
  db: Database,
  session: { id: string; startedAt: Date },
  endedAt: Date,
  perMinuteCents: number,
  reason: SessionCloseReason
): Promise<DriverSession> {
  const durationMinutes = computeDurationMinutes(session.startedAt, endedAt);
  const chargeCents = durationMinutes * perMinuteCents;
  const [updated] = await db
    .update(driverSessionsTable)
    .set({ endedAt, durationMinutes, chargeCents, closedReason: reason, updatedAt: new Date() })
    .where(eq(driverSessionsTable.id, session.id))
    .returning();
  if (!updated) throw new Error("Update to driver_sessions returned no row");
  return updated;
}

export async function closeOpenSession(
  db: Database,
  driverId: string,
  endedAt: Date,
  perMinuteCents: number,
  reason: SessionCloseReason
): Promise<DriverSession | null> {
  const session = await getOpenSession(db, driverId);
  if (!session) return null;
  return closeSessionRow(db, session, endedAt, perMinuteCents, reason);
}

/**
 * Safety net for abandoned sessions (app crash, no connectivity) — without
 * this, a driver whose app dies while online would bill forever. Closes any
 * open session whose driver has had no known activity (via the Faz 4
 * LocationHub's `lastSeen`) for over `staleMinutes`, charging only up to the
 * last verified moment of activity (never the unverifiable stale gap), and
 * flips the driver back to OFFLINE — which also fixes a latent dispatch bug
 * where such a driver would otherwise stay falsely bookable forever.
 */
export async function closeStaleSessions(
  db: Database,
  now: Date = new Date(),
  staleMinutes: number = STALE_SESSION_TIMEOUT_MINUTES
): Promise<number> {
  const openSessions = await db
    .select({
      id: driverSessionsTable.id,
      driverId: driverSessionsTable.driverId,
      startedAt: driverSessionsTable.startedAt,
      lastSeen: driverProfilesTable.lastSeen,
    })
    .from(driverSessionsTable)
    .innerJoin(driverProfilesTable, eq(driverSessionsTable.driverId, driverProfilesTable.id))
    .where(isNull(driverSessionsTable.endedAt));

  if (openSessions.length === 0) return 0;

  const { perMinuteCents } = await getDriverUsageRates(db);
  let closedCount = 0;

  for (const session of openSessions) {
    const lastActivity =
      session.lastSeen && session.lastSeen.getTime() > session.startedAt.getTime() ? session.lastSeen : session.startedAt;
    const staleMs = now.getTime() - lastActivity.getTime();
    if (staleMs <= staleMinutes * 60_000) continue;

    await closeSessionRow(db, { id: session.id, startedAt: session.startedAt }, lastActivity, perMinuteCents, "STALE_TIMEOUT");
    await db
      .update(driverProfilesTable)
      .set({ status: "OFFLINE", updatedAt: now })
      .where(eq(driverProfilesTable.id, session.driverId));
    closedCount += 1;
  }

  return closedCount;
}

export function toSessionResponse(session: DriverSession) {
  return {
    id: session.id,
    driverId: session.driverId,
    startedAt: session.startedAt.toISOString(),
    endedAt: session.endedAt?.toISOString() ?? null,
    durationMinutes: session.durationMinutes,
    charge: session.chargeCents != null ? session.chargeCents / 100 : null,
    closedReason: session.closedReason,
  };
}

export interface DriverBalance {
  usageFeeChargedCents: number;
  commissionChargedCents: number;
  totalChargedCents: number;
  totalCollectedCents: number;
  pendingBalanceCents: number;
  hasOpenSession: boolean;
}

/**
 * A driver's combined debt owed to GNN LLC: closed-session usage-fee charges
 * + a currently-open session's live accrual (so the figure is accurate up
 * to the minute, not just as of its last close) + trip commissions (Faz 5c,
 * admin-assigned trips only), minus cash already collected.
 */
export async function computeDriverBalance(db: Database, driverId: string, now: Date = new Date()): Promise<DriverBalance> {
  const [closedSum] = await db
    .select({ total: sql<number>`coalesce(sum(${driverSessionsTable.chargeCents}), 0)` })
    .from(driverSessionsTable)
    .where(and(eq(driverSessionsTable.driverId, driverId), isNotNull(driverSessionsTable.endedAt)));

  const openSession = await getOpenSession(db, driverId);
  let liveCents = 0;
  if (openSession) {
    const { perMinuteCents } = await getDriverUsageRates(db);
    liveCents = computeLiveChargeCents(openSession, perMinuteCents, now);
  }

  const [commissionSum] = await db
    .select({ total: sql<number>`coalesce(sum(${driverTripCommissionsTable.commissionCents}), 0)` })
    .from(driverTripCommissionsTable)
    .where(eq(driverTripCommissionsTable.driverId, driverId));

  const [collectedSum] = await db
    .select({ total: sql<number>`coalesce(sum(${driverCashCollectionsTable.amountCents}), 0)` })
    .from(driverCashCollectionsTable)
    .where(eq(driverCashCollectionsTable.driverId, driverId));

  const usageFeeChargedCents = Number(closedSum?.total ?? 0) + liveCents;
  const commissionChargedCents = Number(commissionSum?.total ?? 0);
  const totalChargedCents = usageFeeChargedCents + commissionChargedCents;
  const totalCollectedCents = Number(collectedSum?.total ?? 0);

  return {
    usageFeeChargedCents,
    commissionChargedCents,
    totalChargedCents,
    totalCollectedCents,
    pendingBalanceCents: totalChargedCents - totalCollectedCents,
    hasOpenSession: openSession !== null,
  };
}
