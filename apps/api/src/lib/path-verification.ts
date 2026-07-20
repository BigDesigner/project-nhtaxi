import { asc, eq } from "drizzle-orm";
import { tripBreadcrumbsTable, tripsTable, type Database } from "@gnncab/db";
import { haversineMiles } from "./fare";

/**
 * How far a breadcrumb may sit from the trip's own pickup/dropoff before the
 * two are considered not to match. GPS alone can be off by a few hundred feet
 * in the mountains, and pickup spots vary in how precisely they're pinned —
 * this is a deliberately loose first cut, not a claim of high precision.
 */
export const PATH_TOLERANCE_MILES = 0.5;

export interface PathVerificationResult {
  status: "NOT_CHECKED" | "MATCHED" | "MISMATCHED";
  deviationMiles: number | null;
}

/**
 * Checks a completed trip's own recorded pickup/dropoff against where the
 * car's breadcrumb trail actually started and ended.
 *
 * Anchored on the trip's own endpoints, not a passenger's GPS — most trips
 * have no passenger location data to compare against at all (a referral job
 * has no passenger account, so there's nothing to anchor on there), and
 * anchoring on the booking is what lets one check run identically for every
 * trip type without asking a passenger for anything new. The office's actual
 * exposure is a driver understating a referred job's distance, not a
 * passenger's address being wrong — this checks the side that can move money.
 *
 * A trip with no breadcrumbs — a phone with no signal the whole ride, or one
 * that predates this feature — comes back NOT_CHECKED rather than flagged.
 * There is no evidence either way, and treating silence as guilt would be
 * worse than treating it as unknown.
 */
export async function verifyTripPath(db: Database, tripId: string): Promise<PathVerificationResult> {
  const [trip] = await db.select().from(tripsTable).where(eq(tripsTable.id, tripId)).limit(1);
  if (!trip || trip.dropoffLat == null || trip.dropoffLng == null) {
    return { status: "NOT_CHECKED", deviationMiles: null };
  }

  const points = await db
    .select({ lat: tripBreadcrumbsTable.lat, lng: tripBreadcrumbsTable.lng })
    .from(tripBreadcrumbsTable)
    .where(eq(tripBreadcrumbsTable.tripId, tripId))
    .orderBy(asc(tripBreadcrumbsTable.recordedAt));

  if (points.length === 0) {
    return { status: "NOT_CHECKED", deviationMiles: null };
  }

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const pickupDeviation = haversineMiles(trip.pickupLat, trip.pickupLng, first.lat, first.lng);
  const dropoffDeviation = haversineMiles(trip.dropoffLat, trip.dropoffLng, last.lat, last.lng);
  const worst = Math.max(pickupDeviation, dropoffDeviation);

  return {
    status: worst <= PATH_TOLERANCE_MILES ? "MATCHED" : "MISMATCHED",
    deviationMiles: Math.round(worst * 100) / 100,
  };
}

/**
 * Computes and persists the result. Called once, synchronously, right when a
 * trip completes — this is pure DB work with no external network call, so
 * unlike the push/email side effects on the same transition it is awaited
 * rather than fired via `waitUntil`: the completing driver's own response can
 * reflect the result immediately instead of needing a second fetch.
 */
export async function recordTripPathVerification(db: Database, tripId: string): Promise<PathVerificationResult> {
  const result = await verifyTripPath(db, tripId);
  await db
    .update(tripsTable)
    .set({ pathVerification: result.status, pathDeviationMiles: result.deviationMiles })
    .where(eq(tripsTable.id, tripId));
  return result;
}
