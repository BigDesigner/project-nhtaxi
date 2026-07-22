/**
 * Driving distance along real roads.
 *
 * This replaces an earlier straight-line estimate multiplied by a fudge
 * factor. That approach was wrong in a way that costs GNN LLC money on every
 * single trip: the final fare is derived from this distance, so any error
 * here is charged to the business. A factor that happens to fit a Boston run
 * is badly wrong for a winding White Mountains route, and there is no single
 * number that fits both. The only correct answer is to ask a routing engine
 * what the car will actually drive.
 *
 * Deliberately there is **no fallback to an estimated distance**. If routing
 * is unavailable we refuse to quote rather than invent a number — a booking
 * that can't be priced is an inconvenience, a booking priced wrongly is a
 * loss on every mile.
 */

const METRES_PER_MILE = 1609.344;

/** Routing is down or refused us. Callers should surface this, not paper over it. */
export class RoutingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoutingUnavailableError";
  }
}

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * Coordinates are rounded before they become a cache key. Five decimals is
 * about a metre — far finer than a kerbside pickup is specified anyway — and
 * it makes the airport runs this business actually does hit cache instead of
 * re-routing an identical journey.
 */
function cacheKeyFor(baseUrl: string, from: LatLng, to: LatLng): string {
  const r = (n: number) => n.toFixed(5);
  return `https://routing.internal/${encodeURIComponent(baseUrl)}/${r(from.lat)},${r(from.lng)}/${r(to.lat)},${r(to.lng)}`;
}

interface OsrmResponse {
  code?: string;
  routes?: Array<{ distance?: number }>;
}

/**
 * Road miles between two points, via an OSRM-compatible routing service.
 *
 * The OSRM protocol is used because self-hosted OSRM, several public mirrors,
 * and most commercial routing endpoints speak it, so moving off the default
 * host is a config change rather than a rewrite — see ROUTING_BASE_URL.
 */
export async function roadDistanceMiles(
  env: { ROUTING_BASE_URL?: string },
  from: LatLng,
  to: LatLng
): Promise<number> {
  const baseUrl = (env.ROUTING_BASE_URL || "https://router.project-osrm.org").replace(/\/+$/, "");

  // Same pickup and dropoff — no need to trouble the router.
  if (from.lat === to.lat && from.lng === to.lng) return 0;

  const cacheKey = new Request(cacheKeyFor(baseUrl, from, to));
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  if (cached) {
    const miles = Number(await cached.text());
    if (Number.isFinite(miles)) return miles;
  }

  // OSRM wants lng,lat — the reverse of how the rest of this codebase and
  // every map UI writes coordinates. Getting this backwards silently returns
  // a plausible-looking distance for entirely the wrong journey.
  const url =
    `${baseUrl}/route/v1/driving/` +
    `${from.lng},${from.lat};${to.lng},${to.lat}` +
    `?overview=false&alternatives=false&steps=false`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": "NHTaxi/1.0 (https://nhtaxi.com)" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (cause) {
    throw new RoutingUnavailableError(`Could not reach the routing service: ${String(cause)}`);
  }

  if (!response.ok) {
    throw new RoutingUnavailableError(`Routing service returned ${response.status}`);
  }

  const body = (await response.json()) as OsrmResponse;
  const metres = body.routes?.[0]?.distance;
  if (body.code !== "Ok" || typeof metres !== "number" || !Number.isFinite(metres)) {
    // "NoRoute" lands here too: genuinely unreachable by road (wrong side of
    // water, or a coordinate dropped in the sea) is not something to guess at.
    throw new RoutingUnavailableError(`No driving route found (${body.code ?? "unknown"})`);
  }

  const miles = Math.round((metres / METRES_PER_MILE) * 100) / 100;

  // Cached for a month: roads don't move, and a repeat airport run should not
  // cost another lookup. The cache is best-effort, so a failure to store is
  // ignored rather than failing the quote.
  await cache.put(
    cacheKey,
    new Response(String(miles), { headers: { "Cache-Control": "max-age=2592000" } })
  ).catch(() => {});

  return miles;
}
