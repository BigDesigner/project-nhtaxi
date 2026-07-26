# ADR 0002: Cloudflare Deployment Topology

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-19

## Context
The application components (API, Web Admin) need dedicated hostnames and deployment definitions to operate smoothly under the Cloudflare ecosystem while adhering to the business constraints (using existing domains).

## Decision
- **API Domain**: `api.nhtaxi.com` will host the Hono Worker (serving both REST and WebSocket traffic).
- **Admin Domain**: `admin.nhtaxi.com` will host the Web Admin interface (Cloudflare Pages).
- **Deployments**: Handled via `wrangler.toml` for the Worker and native Pages integration.
- **CI/CD**: GitHub Actions (`deploy.yml`) is the sole mechanism for applying D1 migrations and deploying to production to ensure a consistent, safe release pipeline.

## Consequences
- Zero manual deployments allowed to production.
- All secrets (JWT, R2 keys, FCM keys) must be managed securely via `wrangler secret put` and are intentionally kept out of the repository.

## Evidence
- `apps/api/wrangler.toml`
- `.github/workflows/deploy.yml`
- `.memory-bank/migration-map.md` — the original rebuild plan's locked
  decisions L27, L28 (the source doc was retired once fully migrated; the
  fuller domain/cutover picture is ADR 0010).

> Note (2026-07-22): as built, the API is live at `api.nhtaxi.com` and the Flutter web preview at `gnncab-preview.pages.dev` (custom domain `gnncab.nhtaxi.com` pending, user-owned). No separate `admin.nhtaxi.com` React app was deployed — admin is inside the Flutter app (ADR 0006).
