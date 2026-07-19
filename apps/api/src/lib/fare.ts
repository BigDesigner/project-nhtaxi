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

/** Reads the admin-editable global pricing_config row (L8); falls back to
 * the documented defaults ($2.50 + $1.20/mi) if none has been set yet. */
export async function estimateFare(
  db: Database,
  distanceMiles: number
): Promise<{ distanceMiles: number; estimatedFareCents: number; currency: string }> {
  const [row] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);
  const baseFareCents = row?.baseFareCents ?? DEFAULT_BASE_FARE_CENTS;
  const perMileCents = row?.perMileCents ?? DEFAULT_PER_MILE_CENTS;
  const roundedDistance = Math.round(distanceMiles * 100) / 100;
  const estimatedFareCents = Math.round(baseFareCents + roundedDistance * perMileCents);
  return { distanceMiles: roundedDistance, estimatedFareCents, currency: row?.currency ?? "USD" };
}
