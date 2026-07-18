# GNNcab

Ride-dispatch platform for GNN LLC (North Conway, NH). Runs on Cloudflare's
free tier end-to-end — see [.spec/rebuild_plan.md](.spec/rebuild_plan.md) for
the full plan and every locked decision (L0–L31). This README only covers the
one-time setup and day-to-day dev commands.

## Repo layout

```
apps/
  api/        Backend — Hono on Cloudflare Workers (D1 + R2 + Durable Objects)
  admin/      Web admin — ported from the legacy React app (Faz 8)
  mobile/     Flutter app — passenger/driver/admin, one app (Faz 7)
packages/
  db/         Drizzle schema (D1/SQLite), shared by the API and migrations
  contract/   Shared zod schemas — the source the OpenAPI doc is generated from
.github/workflows/
  ci.yml      Pull request: typecheck + test + API preview deploy
  deploy.yml  main branch: typecheck + test + D1 backup + migrate + deploy
```

## Local development

```bash
pnpm install
cp apps/api/.dev.vars.example apps/api/.dev.vars   # fill in JWT_SECRET
pnpm run typecheck
pnpm run test
pnpm --filter @gnncab/api run dev                   # wrangler dev, http://localhost:8787
```

Local `wrangler dev` runs against a local D1/R2/Durable Object emulation
(miniflare) — no Cloudflare account needed for this.

### Database migrations

Schema lives in `packages/db/src/schema`. After changing it:

```bash
cd apps/api
pnpm run db:generate          # drizzle-kit generate → apps/api/migrations/*.sql
pnpm run db:migrate:local      # apply to the local emulated D1
```

Commit the generated `migrations/*.sql` files. `db:migrate:remote` (or the
`deploy.yml` workflow) applies them to the real D1 database.

## One-time Cloudflare setup

Nothing here runs automatically the first time — do this once, then every
push to `main` deploys itself via CI.

1. **Authenticate wrangler** (only needed for the manual steps below; CI uses
   an API token instead):
   ```bash
   npx wrangler login
   ```

2. **Create the D1 database**, then paste the returned id into
   `apps/api/wrangler.toml` (`database_id`, currently a placeholder):
   ```bash
   cd apps/api
   npx wrangler d1 create gnncab
   ```

3. **Create the R2 bucket** for driver documents (L17):
   ```bash
   npx wrangler r2 bucket create gnncab-driver-documents
   ```

4. **Push app secrets** (never stored in a file or in wrangler.toml — L25):
   ```bash
   npx wrangler secret put JWT_SECRET
   # Stripe/FCM secrets get added here the same way once Faz 6/9 land.
   ```

5. **Custom domain**: `nhtaxi.com` is already on this Cloudflare account, so
   nothing manual is needed — `wrangler.toml` already declares
   `api.nhtaxi.com` as a custom domain (L27/L29) and the first `wrangler
   deploy` creates the route + DNS record automatically. `app.` and
   `tracker.` are reserved by the existing Trackcar app — don't reuse them
   (L31).

6. **Apply the first migration to the real database**:
   ```bash
   npx wrangler d1 migrations apply gnncab --remote
   ```

## GitHub Secrets (for CI/CD)

Add these under the repo's Settings → Secrets and variables → Actions. Until
they exist, `ci.yml`/`deploy.yml` still run typecheck+test but skip the
deploy steps (they don't hard-fail).

| Secret | Where to get it |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Dashboard → My Profile → API Tokens → Create Token. Scope it to this account only, with: Workers Scripts (Edit), D1 (Edit), R2 (Edit), Workers Routes / Zone DNS (Edit) for `nhtaxi.com`. |
| `CLOUDFLARE_ACCOUNT_ID` | Dashboard → any domain's Overview page, right sidebar. |

## Deploy flow (after the one-time setup above)

- Open a PR → CI runs typecheck/test and uploads a Worker preview version
  (a `*.workers.dev` URL, posted by wrangler in the Action log).
- Merge to `main` → `deploy.yml` runs typecheck/test, exports a D1 backup,
  applies migrations, then deploys the Worker to `api.nhtaxi.com`.
- No manual `wrangler deploy` should be needed after the one-time setup.
