import { and, eq, notInArray } from "drizzle-orm";
import { driverProfilesTable, tripEventsTable, tripsTable, type Database } from "@gnncab/db";
import { haversineMiles } from "./fare";

export const MAX_DISPATCH_RADIUS_MILES = 10;
export const MAX_DISPATCH_ATTEMPTS = 3;
export const DISPATCH_TIMEOUT_MS = 60_000;

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
