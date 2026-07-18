# apps/admin (placeholder)

Web admin — Faz 8 per [.spec/rebuild_plan.md](../../.spec/rebuild_plan.md).

Ported from the legacy React admin at
`C:\Users\bigde\.antigravity\GNNcab\artifacts\gnncab` (React 19 + Vite + Tailwind
+ shadcn/ui, cookie+CSRF auth already in place — L9). Driver/customer pages are
dropped; only admin routes are kept. The generated API client is regenerated
against this repo's OpenAPI doc (`apps/api` → `/api/openapi.json`) instead of
the old hand-maintained `openapi.yaml`.

Deployed to `admin.nhtaxi.com` via Cloudflare Pages (L27).
