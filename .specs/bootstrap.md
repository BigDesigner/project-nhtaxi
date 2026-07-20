# Project Setup & Bootstrap

## Prerequisites [Verified]
- Node.js (via pnpm)
- Cloudflare Wrangler CLI (`npx wrangler`)
- Flutter SDK (for mobile)

## Package Manager [Verified]
- `pnpm` (Workspace configured).

## Installation [Verified]
```bash
pnpm install
```

## Environment Variables [Verified]
```bash
# apps/api/.dev.vars
JWT_SECRET=your_32_byte_secret_here
DOCUMENT_ENCRYPTION_KEY=your_key_here
ADMIN_BOOTSTRAP_TOKEN=your_token_here
FCM_SERVICE_ACCOUNT_KEY=your_fcm_json
BREVO_API_KEY=your_brevo_api_key
```

## Production Secrets [Verified]
Set once via Wrangler — never committed, never passed through chat or any
other plaintext channel:
```bash
cd apps/api
npx wrangler secret put BREVO_API_KEY   # run yourself; prompts for the value
```
Empty/unset is treated as "not configured yet" and every email call silently
no-ops rather than throwing — same rollout pattern as `FCM_SERVICE_ACCOUNT_KEY`.

## Database Setup & Migration [Verified]
```bash
cd apps/api
pnpm run db:generate
pnpm run db:migrate:local  # Local D1 emulation
# Production: npx wrangler d1 migrations apply gnncab --remote
```

## Dev Server [Verified]
```bash
pnpm --filter @gnncab/api run dev
```

## Validation Commands [Verified]
```bash
pnpm run typecheck
pnpm run test
```

## CI/CD Pipelines [Verified]
- `.github/workflows/ci.yml`: Triggered on PRs. Runs typecheck, test, and preview deploy.
- `.github/workflows/deploy.yml`: Triggered on `main`. Runs typecheck, test, D1 export backup, D1 migration apply, Workers deploy, Pages deploy.

## Deployment Files [Verified]
- `apps/api/wrangler.toml`: Cloudflare Workers & Durable Objects definitions.
