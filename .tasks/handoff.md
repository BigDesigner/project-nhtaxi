# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `77323af` — "Charge commission on referred jobs only, not on everything"
- **Worktree status**: Clean, pushed, deployed
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
  - **Faz 11 wave A**: commission now follows `trips.referralSource`, not
    `origin`. Driver ticks a box on accept (pre-ticked and locked when the
    office assigned it, and never able to *clear* a referral); admin can set
    or clear it on any live trip and that wins. Audit-logged.
  - **Testing round 3**: fixed driver sign-up being unreachable (redirect
    guard matched `/signup` exactly, bouncing `/signup/driver` to login);
    split passenger trips onto their own tab; driver map no longer vanishes
    when nobody is on shift.
  - **Faz 10**: real driving distance from a routing engine (replacing a
    straight-line estimate ×1.3), gated sign-up with separate passenger and
    driver terms, and a change-password endpoint.
- **What was verified**: 143/143 backend, 44/44 Flutter, analyze clean, both
  CI workflows green, migrations `0004`–`0006` applied cleanly to remote D1,
  and live smoke tests against production covering distance accuracy, terms
  enforcement, driver-route auth and the password-change flow.
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && npx vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action** — Faz 11 wave B, already agreed with the user:
  1. Live referral trips: the driver taps a Referral button at the kerb, a
     trip opens at their current GPS, and closes at their GPS on drop-off.
     Removes driver-declared amounts entirely.
  2. Breadcrumbs every ~30s during a trip, drawn on a map in the admin panel.
     The user considers the audit trail important ("ayak izi önemli").
  3. Metered fare from the real route rather than the booking estimate.
  4. Needs `DRIVER_REFERRAL` in `TRIP_ORIGINS` → CHECK constraint rewrite →
     **trips table rebuild. Give it its own migration, alone.** This is the
     operation that failed twice remotely.
- **Things only the user can do**:
  - Move `ROUTING_BASE_URL` off the public OSRM demo instance before real
    volume.
  - Supply the Firebase service-account key (push is wired but no-ops).
  - Attach `gnncab.nhtaxi.com` to the `gnncab-preview` Pages project.
