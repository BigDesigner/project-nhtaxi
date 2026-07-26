# ADR 0010: Domain topology and the Trackcar cutover plan

- **Status**: Accepted (topology live; cutover not yet executed)
- **Confidence**: Verified (topology) / Planned (cutover sequence)
- **Date**: 2026-07-19 (decided in the original rebuild plan), recorded here
  retroactively when `.archive/docs-migration/2026-07-19/rebuild_plan.md` was
  retired

## Context
`nhtaxi.com` already runs a WordPress landing page and a legacy live-tracking
app called **Trackcar**, hosted on a DigitalOcean VPS (a real monthly cost),
occupying the `app.` and `tracker.` subdomains. Neither is part of this
project and neither should be disturbed while this rebuild is unproven.

## Decision
**Subdomain map**, none of it colliding with what Trackcar/WordPress already
own:
| Subdomain | Owner |
|---|---|
| `nhtaxi.com` / `www` | WordPress landing — out of scope, never touched |
| `app.nhtaxi.com` | Trackcar (legacy) — reserved, do not reuse until cutover |
| `tracker.nhtaxi.com` | Trackcar (legacy) — reserved, do not reuse until cutover |
| `api.nhtaxi.com` | This project's Worker (REST + WebSocket) |
| `gnncab.nhtaxi.com` | This project's Flutter web preview (temporary name — see ADR 0009) |

**Cutover sequence, once this app is proven in the field:**
1. Onboard real drivers onto this app (accounts, install, brief training).
2. Run this app and Trackcar **in parallel** — drivers use both, so live
   tracking can be cross-checked before anyone depends solely on the new one.
3. Once verified, retire Trackcar.
4. Cancel the DigitalOcean VPS — this is the actual cost payoff of the
   cutover, not just a cleanup step.
5. `app.` and `tracker.` are now free. Move the Flutter web preview from
   `gnncab.nhtaxi.com` to `app.nhtaxi.com` (the intended permanent name).

**Do not cancel the VPS or repoint `app.`/`tracker.` before step 3.** The
parallel-run period is the rollback path if this app has a problem Trackcar
didn't.

## Consequences
- Nothing here is time-pressured — Trackcar keeps working exactly as it does
  today until every step above is deliberately taken.
- `gnncab.nhtaxi.com` remaining the web preview's name until cutover is
  expected and not a bug to fix (ADR 0009).
- A future agent that sees `app.`/`tracker.` "unused" in DNS should not
  assume they're free — check whether the cutover sequence above has
  actually run.

## Evidence
- `apps/mobile/web/index.html`, `.github/workflows/mobile.yml` (`deploy-web`
  job deploys to `gnncab.nhtaxi.com`)
- `.tasks/pipeline.md` — "Legacy Trackcar go-live / cutover" backlog item
- ADR 0009 (the `gnncab.nhtaxi.com` → `app.nhtaxi.com` rename is gated on
  this cutover, not a separate decision)
