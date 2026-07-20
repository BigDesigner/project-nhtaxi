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
 * Turns crow-flies miles into road miles.
 *
 * `haversineMiles` measures a straight line, but nobody drives one — a car
 * always covers more ground than the line between two points. Quoting the
 * straight line therefore under-prices every single trip, and the longer the
 * trip the bigger the gap. Measured against real routes out of North Conway:
 *
 *   Boston Logan    ~105 mi straight,  ~138 mi driving  → 1.31
 *   Portland (PWM)   ~48 mi straight,   ~62 mi driving  → 1.29
 *   Manchester (MHT) ~72 mi straight,   ~95 mi driving  → 1.32
 *
 * 1.3 fits this region well: the White Mountains force routes around terrain,
 * so there is rarely a direct road. Somewhere flatter and more gridded would
 * sit nearer 1.2.
 *
 * This is a constant rather than a pricing_config column on purpose — it
 * describes the road network, not a commercial decision. The commercial dial
 * is perMileCents, which admins already control.
 *
 * The honest fix would be a real routing engine, but every free one comes
 * with rate limits or an attribution/licence burden, and this gets the
 * quote close enough that a passenger isn't surprised at the kerb.
 */
export const ROAD_DISTANCE_FACTOR = 1.3;

/** Reads the admin-editable global pricing_config row (L8); falls back to
 * the documented defaults ($2.50 + $1.20/mi) if none has been set yet.
 *
 * Takes straight-line miles and applies ROAD_DISTANCE_FACTOR itself, so every
 * caller prices the same way — the returned `distanceMiles` is the estimated
 * *road* distance, which is also what gets shown to the passenger. */
export async function estimateFare(
  db: Database,
  straightLineMiles: number
): Promise<{ distanceMiles: number; estimatedFareCents: number; currency: string }> {
  const [row] = await db.select().from(pricingConfigTable).where(isNull(pricingConfigTable.cityId)).limit(1);
  const baseFareCents = row?.baseFareCents ?? DEFAULT_BASE_FARE_CENTS;
  const perMileCents = row?.perMileCents ?? DEFAULT_PER_MILE_CENTS;
  const roadMiles = Math.round(straightLineMiles * ROAD_DISTANCE_FACTOR * 100) / 100;
  const estimatedFareCents = Math.round(baseFareCents + roadMiles * perMileCents);
  return { distanceMiles: roadMiles, estimatedFareCents, currency: row?.currency ?? "USD" };
}
