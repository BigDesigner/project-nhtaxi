# ADR 0004: Fares are priced on real road distance, and fail closed

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (decision locked during Faz 10; recorded here retroactively)

## Context
The fare is the single most load-bearing number in the system: `finalFareCents` falls back to `estimatedFareCents`, so any error in the distance is charged to GNN LLC on every mile of every trip. An early version priced trips on haversine (straight-line) distance × 1.3. That constant is wrong by a different amount on every route — a winding mountain valley road and a highway run do not share a factor — so it silently under- or over-charged. Live proof: North Conway → Boston Logan is ~135–140 real driving miles; straight-line-only quoted 117 (undercharge), straight-line×1.3 quoted 151.8 (overcharge); real routing quotes 136.27.

## Decision
- Price every trip on **real driving distance** from an OSRM-compatible routing engine (`lib/routing.ts`), configured by `ROUTING_BASE_URL` in `wrangler.toml`.
- **No fallback to an approximation.** If routing is unavailable the API returns **503** (`RoutingUnavailable`, handled centrally in `app.ts`) and refuses to quote. A booking that can't be priced is an inconvenience; a booking priced wrongly is a loss.
- OSRM takes coordinates as **`lng,lat`** — the reverse of everything else in this codebase and every map UI. A reversed pair still returns a confident distance for a completely different journey, so there is a test pinning the order.
- Cache results for a month keyed by rounded coordinates (taxi work repeats the same airport runs constantly).
- `haversineMiles` survives in `lib/fare.ts` **only** for ranking nearby drivers during dispatch, where "roughly who is closest" is fine and no money depends on it.

## Consequences
- Pricing depends on an external service being reachable. Today `ROUTING_BASE_URL` points at the **public OSRM demo instance**, which is not a production service and can rate-limit us — at which point quoting fails closed (503). **Move it to a self-hosted or paid endpoint before real volume**; that is a one-line config change, no code.
- The test suite must never hit the real router (slow, flaky, rude to a free community server): `test/stub-routing.ts` stubs global `fetch`.
- Booking quotes are shown as a ±10% band (`core/fare_range.dart`), never a single exact figure, so a normal re-route isn't an argument at the kerb; a completed trip's `finalFare` is shown exactly. The two are distinguished by `finalFare != null`.

## Evidence
- `apps/api/src/lib/routing.ts`, `lib/fare.ts`, `app.ts` (503 handler), `test/stub-routing.ts`
- `apps/api/wrangler.toml` (`ROUTING_BASE_URL`)
- `.memory-bank/changelog/verified-worklog.md` → "Distance is real driving distance"
