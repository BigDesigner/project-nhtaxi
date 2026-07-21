import type { BatchItem } from "drizzle-orm/batch";
import { eq, sql } from "drizzle-orm";
import { driverProfilesTable, tripRatingsTable, type Database } from "@gnncab/db";

/**
 * The average of the five stars for one rating, 1.0–5.0. Kept in one place so
 * the value stored on the row and any recomputation agree exactly.
 */
export function overallOf(r: {
  courtesy: number;
  safety: number;
  punctuality: number;
  communication: number;
  cleanliness: number;
}): number {
  const sum = r.courtesy + r.safety + r.punctuality + r.communication + r.cleanliness;
  return Math.round((sum / 5) * 100) / 100;
}

/**
 * A drizzle statement that recomputes a driver's headline rating + count from
 * scratch off `trip_ratings` and writes them onto `driver_profiles`.
 *
 * Recompute-from-scratch, not an incremental += : the two can drift, and at
 * this volume (a handful of ratings per driver) an aggregate query is free.
 * Returned as a statement rather than executed so the caller can run it in the
 * same `db.batch()` as the rating insert — the insert and the average it
 * produces must land together or not at all.
 */
export function recomputeDriverRatingStatement(db: Database, driverId: string): BatchItem<"sqlite"> {
  return db
    .update(driverProfilesTable)
    .set({
      rating: sql`(select round(avg(${tripRatingsTable.overall}), 2) from ${tripRatingsTable} where ${tripRatingsTable.driverId} = ${driverId})`,
      ratingCount: sql`(select count(*) from ${tripRatingsTable} where ${tripRatingsTable.driverId} = ${driverId})`,
      updatedAt: new Date(),
    })
    .where(eq(driverProfilesTable.id, driverId));
}
