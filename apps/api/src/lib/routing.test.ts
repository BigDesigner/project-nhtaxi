import { describe, expect, it, vi } from "vitest";
import { RoutingUnavailableError, roadDistanceMiles } from "./routing";

const NORTH_CONWAY = { lat: 44.0537, lng: -71.1281 };
const BOSTON_LOGAN = { lat: 42.3656, lng: -71.0096 };

/** Replaces global fetch for one assertion, and hands back what was requested. */
function captureRouting(reply: () => Response): { urls: string[] } {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return reply();
  });
  return { urls };
}

// Distinct coordinates per test: results are cached for a month by
// coordinate, so reusing a pair would have one test answering another's.
function uniquePair(seed: number) {
  return {
    from: { lat: 44 + seed / 1000, lng: -71.1 },
    to: { lat: 42.4, lng: -71 - seed / 1000 },
  };
}

describe("roadDistanceMiles", () => {
  it("converts the routing engine's metres into miles", async () => {
    // 138.4 miles in metres — a realistic North Conway → Boston drive.
    captureRouting(() => Response.json({ code: "Ok", routes: [{ distance: 222_733 }] }));

    const { from, to } = uniquePair(1);
    expect(await roadDistanceMiles({}, from, to)).toBeCloseTo(138.4, 1);
  });

  it("asks the router for lng,lat — not lat,lng", async () => {
    // The single most dangerous mistake in this file: OSRM takes coordinates
    // in the opposite order to every map UI and to the rest of this codebase.
    // Reversed, it still returns a confident distance — for a completely
    // different journey, on the other side of the world.
    const captured = captureRouting(() => Response.json({ code: "Ok", routes: [{ distance: 1000 }] }));

    await roadDistanceMiles({}, NORTH_CONWAY, BOSTON_LOGAN);

    expect(captured.urls[0]).toContain(`${NORTH_CONWAY.lng},${NORTH_CONWAY.lat};${BOSTON_LOGAN.lng},${BOSTON_LOGAN.lat}`);
  });

  it("refuses to answer when the router is unreachable", async () => {
    // The whole point: no silent fallback to a guessed distance. The final
    // fare is derived from this number, so a wrong answer is money lost on
    // every mile — failing loudly is the cheaper outcome.
    captureRouting(() => new Response("nope", { status: 503 }));

    const { from, to } = uniquePair(2);
    await expect(roadDistanceMiles({}, from, to)).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it("refuses when there is no road between the two points", async () => {
    captureRouting(() => Response.json({ code: "NoRoute", routes: [] }));

    const { from, to } = uniquePair(3);
    await expect(roadDistanceMiles({}, from, to)).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it("refuses when the response is missing a distance", async () => {
    captureRouting(() => Response.json({ code: "Ok", routes: [{}] }));

    const { from, to } = uniquePair(4);
    await expect(roadDistanceMiles({}, from, to)).rejects.toBeInstanceOf(RoutingUnavailableError);
  });

  it("does not call the router for a zero-length trip", async () => {
    const captured = captureRouting(() => Response.json({ code: "Ok", routes: [{ distance: 5000 }] }));

    expect(await roadDistanceMiles({}, NORTH_CONWAY, NORTH_CONWAY)).toBe(0);
    expect(captured.urls).toHaveLength(0);
  });

  it("reuses a cached answer instead of routing the same journey twice", async () => {
    // Taxi work repeats heavily — the same airport run, all day. Re-routing
    // each one wastes the rate limit we depend on.
    const captured = captureRouting(() => Response.json({ code: "Ok", routes: [{ distance: 16_093.44 }] }));
    const { from, to } = uniquePair(5);

    const first = await roadDistanceMiles({}, from, to);
    const second = await roadDistanceMiles({}, from, to);

    expect(first).toBe(second);
    expect(captured.urls).toHaveLength(1);
  });

  it("honours a configured routing host", async () => {
    // Moving off the public demo instance must be config, not code.
    const captured = captureRouting(() => Response.json({ code: "Ok", routes: [{ distance: 1609.344 }] }));
    const { from, to } = uniquePair(6);

    await roadDistanceMiles({ ROUTING_BASE_URL: "https://routing.example.com" }, from, to);

    expect(captured.urls[0]?.startsWith("https://routing.example.com/route/v1/driving/")).toBe(true);
  });
});
