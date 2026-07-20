import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { createDb } from "@gnncab/db";
import { estimateFare, haversineMiles } from "./fare";

// North Conway, NH — the base of operations.
const NORTH_CONWAY = { lat: 44.0537, lng: -71.1281 };
// Boston Logan: the long airport run the pricing has to get right.
const BOSTON_LOGAN = { lat: 42.3656, lng: -71.0096 };

describe("haversineMiles", () => {
  // Note this is *not* used for pricing — see estimateFare below. It survives
  // only to rank nearby drivers during dispatch, where "roughly who is
  // closest" is a fine proxy and no money depends on it.
  it("measures a known leg", () => {
    const miles = haversineMiles(NORTH_CONWAY.lat, NORTH_CONWAY.lng, BOSTON_LOGAN.lat, BOSTON_LOGAN.lng);
    expect(miles).toBeGreaterThan(110);
    expect(miles).toBeLessThan(125);
  });

  it("is zero for the same point", () => {
    expect(haversineMiles(NORTH_CONWAY.lat, NORTH_CONWAY.lng, NORTH_CONWAY.lat, NORTH_CONWAY.lng)).toBeCloseTo(0);
  });
});

describe("estimateFare", () => {
  it("prices exactly the driving distance it is given", async () => {
    // The contract that matters: whatever the routing engine says the car
    // will drive is what gets charged. No scaling, no correction factor —
    // an earlier version multiplied a straight line by 1.3 and was wrong by
    // a different amount on every route.
    const db = createDb(env.DB);
    const { distanceMiles, estimatedFareCents, currency } = await estimateFare(db, 138.4);

    expect(distanceMiles).toBe(138.4);
    expect(estimatedFareCents).toBe(Math.round(250 + 138.4 * 120));
    expect(currency).toBe("USD");
  });

  it("charges the base fare even for a trip of no distance", async () => {
    const db = createDb(env.DB);
    expect((await estimateFare(db, 0)).estimatedFareCents).toBe(250);
  });

  it("scales linearly, so twice the road distance doubles the mileage part", async () => {
    const db = createDb(env.DB);
    const short = await estimateFare(db, 5);
    const long = await estimateFare(db, 10);
    expect(long.estimatedFareCents - 250).toBeCloseTo((short.estimatedFareCents - 250) * 2, 0);
  });

  it("rounds the distance to the cent-relevant precision only", async () => {
    const db = createDb(env.DB);
    expect((await estimateFare(db, 12.3456)).distanceMiles).toBe(12.35);
  });
});
