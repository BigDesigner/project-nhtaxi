# apps/admin (not built — superseded)

**There is no separate web-admin app.** The original plan was a React admin
ported from the legacy app and hosted at `admin.nhtaxi.com` (Faz 8). That was
superseded: the admin/owner panel was built **into the single Flutter app**
(`apps/mobile/lib/features/admin/`) in Faz 9, reachable by an account with
`isAdmin: true`. See **ADR 0006** and **ADR 0008**.

This directory is kept only as a placeholder. If a dedicated web admin is ever
wanted, the archived plan is at
[.archive/docs-migration/2026-07-19/rebuild_plan.md](../../.archive/docs-migration/2026-07-19/rebuild_plan.md)
and the legacy React source at
`C:\Users\bigde\.antigravity\GNNcab\artifacts\gnncab` (React 19 + Vite +
Tailwind + shadcn/ui). It would regenerate its API client from this repo's
OpenAPI doc (`apps/api` → `/api/openapi.json`).
