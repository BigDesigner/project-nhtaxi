# ADR 0003: Revenue model — rent for app time, commission only on referrals, cash only

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (decision locked during Faz 5b/5c and Faz 11 wave A; recorded here retroactively)

## Context
The project began assuming a Stripe/Uber-style platform cut on every fare. Mid-build the business reality asserted itself: GNN LLC is a ~10–20 driver local operation whose drivers are independent owner-operators. Stripe/in-app payment was dropped indefinitely; money is collected in cash, in person, every 10–20 days. A platform that takes a cut of every fare would be wrong for this business — the drivers already pay for access.

## Decision
Two, and only two, revenue streams for GNN LLC, both owed by the driver and settled in cash:

1. **Usage fee (rent).** Every minute a driver's app is non-OFFLINE is billed at `pricing_config.driverUsagePerMinuteCents`, whether or not a job came in. A billable "session" opens/closes on the OFFLINE↔non-OFFLINE toggle (`lib/driver-sessions.ts`); a cron sweep (`crons = ["*/15 * * * *"]`) closes stale sessions so a crashed app never bills forever.
2. **Referral commission.** A percentage cut owed **only on jobs GNN LLC referred** — because ordinary dispatch work is exactly what the rent already buys. Charging commission on everything would be charging twice.

Commission is decided by `trips.referralSource` (`NONE` / `ADMIN_ASSIGNED` / `DRIVER_DECLARED` / `ADMIN_MARKED`), **never by `trips.origin`**, because a referral reaches a driver by several routes that all look like different origins (office assigns in the panel; office phones the passenger "ask for Dan" and it arrives as an ordinary booking; office marks it afterwards). The driver's tick is one-way (can turn a referral on, never clear one the office set); the office has the last word via `PUT /api/admin/trips/{id}/referral` on any live trip. The rate is snapshotted when the driver accepts so a later global-rate change can't rewrite it.

`PAYMENT_METHODS = ["cash"]` is enforced at the **contract layer only**; the DB `CHECK` constraint is deliberately left wide so re-enabling card payment later is a one-line contract change, not a migration.

## Consequences
- Cash from a completed trip never touches the system — it is the driver's, paid to them directly by the passenger. The only money the app records is what the driver owes back (usage fee + commission) and what the office has collected against it.
- The driver Balance tab is framed as "what I owe", not "earnings"; the driver Earnings export is a separate record of *their* turnover for *their* taxes (see ADR 0007).
- Any code that assumes a per-fare platform cut is wrong. `referralSource`, not `origin`, is load-bearing and must stay that way.
- Stripe (legacy "Phase 9") is indefinitely postponed but trivially reversible at the contract layer.

## Evidence
- `packages/db/src/schema/driver_sessions.ts`, `driver_trip_commissions.ts`, `pricing.ts`
- `apps/api/src/lib/driver-sessions.ts`, `routes/admin.ts` (referral override), `routes/referral-commission.test.ts`
- `.memory-bank/changelog/verified-worklog.md` → "Referrals and commission", "Faz 5b/5c"
