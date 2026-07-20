import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "@gnncab/db";
import { estimateFare, haversineMiles, ROAD_DISTANCE_FACTOR } from "./fare";

// North Conway, NH — the base of operations.
const NORTH_CONWAY = { lat: 44.0537, lng: -71.1281 };
// Boston Logan: the long airport run the pricing has to get right.
const BOSTON_LOGAN = { lat: 42.3656, lng: -71.0096 };

describe("haversineMiles", () => {
  it("measures a known long-distance leg", () => {
    const miles = haversineMiles(NORTH_CONWAY.lat, NORTH_CONWAY.lng, BOSTON_LOGAN.lat, BOSTON_LOGAN.lng);
    // ~117 straight-line miles. Loose bounds — this guards against unit or
    // sign errors, not against the fourth decimal place.
    expect(miles).toBeGreaterThan(110);
    expect(miles).toBeLessThan(125);
  });

  it("is zero for the same point", () => {
    expect(haversineMiles(NORTH_CONWAY.lat, NORTH_CONWAY.lng, NORTH_CONWAY.lat, NORTH_CONWAY.lng)).toBeCloseTo(0);
  });
});

describe("estimateFare", () => {
  it("prices the road distance, not the straight line", () => {
    // The bug this locks down: quoting crow-flies miles under-charges every
    // trip, and worse the further you go — nobody drives a straight line to
    // Boston. The passenger-facing quote must already account for that, since
    // it is also what they get charged (finalFare falls back to the estimate).
    expect(ROAD_DISTANCE_FACTOR).toBeGreaterThan(1);
  });

  it("returns road miles and a fare derived from them", async () => {
    const db = createDb(env.DB);
    const straightLine = 10;
    const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, straightLine);

    expect(distanceMiles).toBeCloseTo(straightLine * ROAD_DISTANCE_FACTOR, 2);
    // Default rate card is $2.50 base + $1.20/mi (13 road miles here).
    expect(estimatedFareCents).toBe(Math.round(250 + distanceMiles * 120));
    expect(currency).toBe("USD");
  });

  it("charges the base fare even for a trip of no distance", async () => {
    const db = createDb(env.DB);
    const { estimatedFareCents } = await estimateFare(db, 0);
    expect(estimatedFareCents).toBe(250);
  });

  it("scales linearly, so a doubled distance doubles the per-mile part", async () => {
    const db = createDb(env.DB);
    const short = await estimateFare(db, 5);
    const long = await estimateFare(db, 10);
    expect(long.estimatedFareCents - 250).toBeCloseTo((short.estimatedFareCents - 250) * 2, 0);
  });
});
