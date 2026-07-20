import { isNull } from "drizzle-orm";
import { pricingConfigTable, type Database } from "@gnncab/db";

const EARTH_RADIUS_MILES = 3958.7613;
const DEFAULT_BASE_FARE_CENTS = 250;
const DEFAULT_PER_MILE_CENTS = 120;

export function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_MILES * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Prices a journey from its **driving distance**.
 *
 * `roadMiles` must come from `lib/routing.ts` — the distance a car actually
 * covers on the road. It must never be a straight-line figure, scaled or
 * otherwise: the final fare is derived from this number, so an approximation
 * here is money lost on every trip, and no single scaling factor fits both a
 * valley road and a highway run.
 *
 * Reads the admin-editable global pricing_config row (L8); falls back to the
 * documented defaults ($2.50 + $1.20/mi) if none has been set yet.
 */
export async function estimateFare(
  db: Database,
  roadMiles: number
): Promise<{ distanceMiles: number; estimatedFareCents: number; currency: string }> {
  const [row] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);
  const baseFareCents = row?.baseFareCents ?? DEFAULT_BASE_FARE_CENTS;
  const perMileCents = row?.perMileCents ?? DEFAULT_PER_MILE_CENTS;
  const distanceMiles = Math.round(roadMiles * 100) / 100;
  const estimatedFareCents = Math.round(baseFareCents + distanceMiles * perMileCents);
  return { distanceMiles, estimatedFareCents, currency: row?.currency ?? "USD" };
}
