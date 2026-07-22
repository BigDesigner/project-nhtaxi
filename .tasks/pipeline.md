# Pipeline & Backlog

## Current state (as of `4e246d5`, 2026-07-22)
Backend Faz 0–6 and the Flutter app (passenger / driver / admin, Faz 7–9) are
built, deployed and live. Faz 10–11 (real road-distance pricing, gated terms,
password rotation, referral commission, live referral trips + breadcrumbs +
path verification) are done. Since then: driver car marker, names in trip
history, full money reporting (CSV + PDF), and short trip IDs + admin lookup +
richer report rows. 204/204 backend tests, 100/100 Flutter, both CI green.

No feature is mid-flight. Present a plan before starting anything sizeable.

## Backlog / candidate next work
- Whatever real-world testing surfaces (this has driven most recent work).
- Report letterhead once the user supplies GNN LLC details (drop into
  `ReportOrg`, ADR 0007).
- Push notifications end-to-end (blocked on user-owned Firebase setup).
- "Reports by email" — mentioned but has no natural trigger event yet; needs a
  design pass before building.
- Legacy Trackcar go-live / cutover (not started).
- Stripe / in-app card payment — indefinitely postponed; reversible at the
  contract layer (`PAYMENT_METHODS`).

## Blockers
- None in code. Several items are user-owned (secrets, routing endpoint, domain
  attach, dual-role conversion) — see `.tasks/handoff.md`.

## Suggested validation plan
- `pnpm run typecheck`
- `cd apps/api && pnpm vitest run`
- `cd apps/mobile && flutter analyze && flutter test`
- After any commit that changes behavior: update the memory bank (AGENTS.md →
  "Memory discipline").
