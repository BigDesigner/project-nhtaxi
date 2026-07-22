# ADR 0008: Owner-operator dual role via users.isAdmin, orthogonal to role

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (decision locked during the service-areas/dual-role work; recorded here retroactively)

## Context
The same person runs the GNN LLC office and also drives. Two obvious approaches are both bad: a combined `role: "admin+driver"` value would force every driver-only check in the codebase (dispatch, the driver app, `assertOwnsTrip`, LocationHub) to learn about a new role; and simply giving a driver the `admin` role would break all those driver checks. Separately, an audit found two API paths (`POST /users`, `PUT /users/{id}`) could mint a second admin, which should never be reachable.

## Decision
- Add `users.isAdmin` (boolean, migration `0009`, plain `ADD COLUMN`) **orthogonal to `role`**. The owner-operator account keeps `role: "driver"` — so dispatch, the driver app, `assertOwnsTrip` and LocationHub all treat it as an ordinary driver with zero special-casing — while `isAdmin: true` unlocks the admin panel through a new `requireAdmin()` gate that replaced `requireRole("admin")` on the admin router.
- **No API path grants admin.** `POST /users` and `PUT /users/{id}` now refuse `role: "admin"` (403); nothing sets `isAdmin` either. The only way to get admin is the one-time self-locking bootstrap endpoint (capped at the first account) or a deliberate, one-off **direct database change**. A leaked or coerced API session can never escalate.
- In the app, which shell is on screen is a **pure UI toggle** (`viewModeProvider`), not a security boundary — both surfaces stay reachable to a dual-role account regardless. Defaults to the driver screens on login, has a cross-over tile in each side's settings, and resets to driver on logout so a later session on the same device can't inherit the wrong shell.

## Consequences
- Adding a genuinely new admin, or converting an account to dual-role, is an intentional manual DB operation — by design, not oversight.
- **Not yet applied to production:** `info@nhtaxi.com` is still `role: "admin", isAdmin: false`. The whole dual-role path is inert until an account is `role: "driver", isAdmin: true`, held back for explicit user confirmation before touching the account that runs the business. The admin-lockdown and dual-role gates are therefore unproven live.

## Evidence
- `apps/api/src/middlewares/auth.ts` (`requireAdmin`), `routes/admin.ts` (role-mint lockdown), migration `0009_square_hulk.sql`
- `apps/mobile/lib/features/**` (`viewModeProvider`), `packages/db/src/schema/users.ts`
- `.memory-bank/changelog/verified-worklog.md` → "Service areas, and the owner-operator dual role"
