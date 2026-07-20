import { describe, expect, it } from "vitest";
import { CookieJar, readJson, req, uniqueEmail } from "../test-utils/http";

const PICKUP = { pickupLat: 44.0, pickupLng: -71.1 };
const DROPOFF = { dropoffLat: 44.05, dropoffLng: -71.15 };

async function registerPassenger(email: string) {
  const jar = new CookieJar();
  const res = await req("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Pat",
      lastName: "Passenger",
      email,
      phone: "+16035550200",
      acceptedTerms: true, acceptedTermsVersion: "2026-07-20", password: "correct horse battery staple",
    }),
  });
  jar.applySetCookie(res);
  return jar;
}

describe("POST /api/trips/estimate", () => {
  it("quotes distance and fare without creating a trip", async () => {
    const jar = await registerPassenger(uniqueEmail("estimate"));

    const res = await req("/api/trips/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF }),
    });
    expect(res.status).toBe(200);

    const body = await readJson(res);
    expect(body.distanceMiles).toBeGreaterThan(0);
    expect(body.estimatedFare).toBeGreaterThan(0);
    expect(body.currency).toBe("USD");

    // The whole point: it's a quote, not a booking.
    const tripsRes = await req("/api/trips", { headers: { Cookie: jar.header() } });
    expect(await readJson(tripsRes)).toEqual([]);
  });

  it("matches the fare the trip actually gets booked at", async () => {
    const jar = await registerPassenger(uniqueEmail("estimate-match"));

    const quoteRes = await req("/api/trips/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF }),
    });
    const quote = await readJson(quoteRes);

    const createRes = await req("/api/trips", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({
        ...PICKUP,
        pickupAddress: "Main St",
        ...DROPOFF,
        dropoffAddress: "Elm St",
        paymentMethod: "cash",
      }),
    });
    const trip = await readJson(createRes);

    expect(trip.estimatedFare).toBeCloseTo(quote.estimatedFare);
    expect(trip.distanceMiles).toBeCloseTo(quote.distanceMiles);
  });

  it("rejects an unauthenticated caller", async () => {
    const res = await req("/api/trips/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...PICKUP, ...DROPOFF }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects out-of-range coordinates", async () => {
    const jar = await registerPassenger(uniqueEmail("estimate-badcoords"));

    const res = await req("/api/trips/estimate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...jar.csrfHeaders() },
      body: JSON.stringify({ pickupLat: 200, pickupLng: -71.1, ...DROPOFF }),
    });
    expect(res.status).toBe(400);
  });
});
