# Constitution & Engineering Standards

## Architecture Boundaries [Verified]
- **Zero Cost Run Infrastructure**: The core objective is maintaining a free tier footprint on Cloudflare. Avoid architectural decisions that introduce monthly base costs.
- **Framework Limits**: Use `Hono` for APIs, `React` for Web Admin, `Flutter` for Mobile.
- **Database**: Cloudflare D1 with `Drizzle ORM`. Do not introduce secondary databases (like Redis or Postgres).
- **Real-time**: Use Durable Objects and WebSockets for real-time tracking, avoiding HTTP polling.

## Code Quality Rules [Verified]
- Shared interfaces must be maintained in `packages/contract` using Zod schemas for OpenAPI generation.
- Strict TypeScript must be enforced. Run `pnpm run typecheck` regularly.

## Git & CI Expectations [Verified]
- Never push straight to `main` without testing locally.
- `deploy.yml` on `main` applies D1 migrations and deploys the Worker.
- CI workflows automatically backup D1 before migrating (`D1 export`).

## Feature Specific Constraints [Verified]
- **Payments**: The Stripe phase is indefinitely postponed. The system is fundamentally cash-based and tracks usage fees & driver commissions based on offline/active time.
- **Language**: English only for UI. (i18n is not required).
- **Timezone**: Storage in UTC, Display/Reporting in America/New_York (ET).
