import { and, eq, notInArray } from "drizzle-orm";
import { driverProfilesTable, tripEventsTable, tripsTable, type Database } from "@gnncab/db";
import { haversineMiles } from "./fare";

export const MAX_DISPATCH_RADIUS_MILES = 10;
export const MAX_DISPATCH_ATTEMPTS = 3;
export const DISPATCH_TIMEOUT_MS = 60_000;

// Faz 7 — if nobody is around, keep looking rather than giving up instantly.
// One sweep a minute for 15 minutes, then park the trip so a passenger who
// walked away isn't searched for forever. Server-side (DO Alarm) rather than
// client polling: it survives the app being closed, costs nothing on the free
// tier, and the cap can't be bypassed by a client that keeps asking.
export const SEARCH_RETRY_INTERVAL_MS = 60_000;
export const MAX_SEARCH_ROUNDS = 15;

/** Records that a sweep found nothing and schedules the next one. */
export async function scheduleNextSearch(
  db: Database,
  tripId: string,
  attempt: number,
  nextSearchAt: Date
): Promise<void> {
  await db
    .update(tripsTable)
    .set({ searchAttempts: attempt, nextSearchAt, status: "REQUESTED", updatedAt: new Date() })
    .where(eq(tripsTable.id, tripId));
}

/** Clears search bookkeeping once a driver is found or the search ends. */
export async function clearSearchSchedule(db: Database, tripId: string): Promise<void> {
  await db.update(tripsTable).set({ nextSearchAt: null, updatedAt: new Date() }).where(eq(tripsTable.id, tripId));
}

export async function findNearestAvailableDriver(
  db: Database,
  pickupLat: number,
  pickupLng: number,
  excludeDriverIds: string[] = []
): Promise<{ driverId: string; distanceMiles: number } | null> {
  const where =
    excludeDriverIds.length > 0
      ? and(eq(driverProfilesTable.status, "AVAILABLE"), notInArray(driverProfilesTable.id, excludeDriverIds))
      : eq(driverProfilesTable.status, "AVAILABLE");

  const candidates = await db.select().from(driverProfilesTable).where(where);

  let nearest: { driverId: string; distanceMiles: number } | null = null;
  for (const d of candidates) {
    if (d.currentLat == null || d.currentLng == null) continue;
    const dist = haversineMiles(pickupLat, pickupLng, d.currentLat, d.currentLng);
    if (dist > MAX_DISPATCH_RADIUS_MILES) continue;
    if (!nearest || dist < nearest.distanceMiles) nearest = { driverId: d.id, distanceMiles: dist };
  }
  return nearest;
}

/** Atomic claim via conditional UPDATE (`WHERE status = 'AVAILABLE'`) — if
 * another dispatch attempt already grabbed this driver, `.returning()` comes
 * back empty and the caller should try the next candidate. */
export async function claimDriver(db: Database, driverId: string): Promise<boolean> {
  const claimed = await db
    .update(driverProfilesTable)
    .set({ status: "BUSY", updatedAt: new Date() })
    .where(and(eq(driverProfilesTable.id, driverId), eq(driverProfilesTable.status, "AVAILABLE")))
    .returning({ id: driverProfilesTable.id });
  return claimed.length > 0;
}

export async function freeDriver(db: Database, driverId: string): Promise<void> {
  await db
    .update(driverProfilesTable)
    .set({ status: "AVAILABLE", updatedAt: new Date() })
    .where(eq(driverProfilesTable.id, driverId));
}

export async function assignTripToDriver(
  db: Database,
  tripId: string,
  driverId: string,
  distanceMiles: number
): Promise<void> {
  const now = new Date();
  await db
    .update(tripsTable)
    .set({ driverId, status: "DRIVER_ASSIGNED", assignedAt: now, updatedAt: now })
    .where(eq(tripsTable.id, tripId));
  await db
    .insert(tripEventsTable)
    .values({ tripId, status: "DRIVER_ASSIGNED", actorRole: "system", metadata: { driverId, distanceMiles } });
}

export async function markTripTimeout(db: Database, tripId: string, reason: string): Promise<void> {
  await db.update(tripsTable).set({ status: "TIMEOUT", updatedAt: new Date() }).where(eq(tripsTable.id, tripId));
  await db.insert(tripEventsTable).values({ tripId, status: "TIMEOUT", actorRole: "system", metadata: { reason } });
}

export async function markDriverNoResponse(db: Database, tripId: string, driverId: string): Promise<void> {
  await db.update(tripsTable).set({ status: "DRIVER_NO_RESPONSE", updatedAt: new Date() }).where(eq(tripsTable.id, tripId));
  await db
    .insert(tripEventsTable)
    .values({ tripId, status: "DRIVER_NO_RESPONSE", actorRole: "system", metadata: { driverId } });
}
