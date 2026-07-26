# NH Taxi

Ride-dispatch platform for GNN LLC in North Conway, NH. Branded NH Taxi to
match `nhtaxi.com`. Runs entirely on Cloudflare's free tier.

Some internal names still read "gnncab": the D1 database, the R2 bucket, the
web preview subdomain. That's the old project name from before the NH Taxi
rebrand. It's not user-facing anywhere, so it wasn't worth renaming (see
ADR 0009).

**Agents / new contributors start here:** read [AGENTS.md](AGENTS.md), then
[.memory-bank/changelog/verified-worklog.md](.memory-bank/changelog/verified-worklog.md)
and [.tasks/handoff.md](.tasks/handoff.md). The original rebuild plan and every
locked decision (L0–L31) are archived at
[.archive/docs-migration/2026-07-19/rebuild_plan.md](.archive/docs-migration/2026-07-19/rebuild_plan.md).
This README only covers one-time setup and day-to-day dev commands.

## Repo layout

```
apps/
  api/        Backend: Hono on Cloudflare Workers (D1 + R2 + Durable Objects)
  admin/      README only. The web admin ended up built into the Flutter app
              instead of a separate React app (see ADR 0006)
  mobile/     Flutter app: passenger, driver, and admin, all in one app
packages/
  db/         Drizzle schema (D1/SQLite), shared by the API and migrations
  contract/   Shared zod schemas that the OpenAPI doc is generated from
.github/workflows/
  ci.yml      Pull request: typecheck + test + API preview deploy
  deploy.yml  main branch: typecheck + test + D1 backup + migrate + deploy
  mobile.yml  main branch: Flutter analyze + test + debug APK + web preview deploy
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
(miniflare), so no Cloudflare account is needed for this.

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

None of this runs automatically the first time. Do it once, and every push
to `main` deploys itself via CI from then on.

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

4. **Push app secrets** (never stored in a file or in wrangler.toml, see L25):
   ```bash
   npx wrangler secret put JWT_SECRET
   # 32 random bytes, base64-encoded. Wraps per-file data keys for driver
   # document envelope encryption (L19):
   node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
   npx wrangler secret put DOCUMENT_ENCRYPTION_KEY
   # Any random string. Gates the one-time, self-locking POST
   # /api/admin/bootstrap (creates the first admin; 409s forever after):
   node -e "console.log(Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64'))"
   npx wrangler secret put ADMIN_BOOTSTRAP_TOKEN
   # Stripe/FCM secrets get added here the same way once Faz 6/9 land.
   ```

   Then create the first admin account (no CLI/SQL needed, see routes/admin.ts):
   ```bash
   curl -X POST https://api.nhtaxi.com/api/admin/bootstrap \
     -H "Content-Type: application/json" \
     -H "X-Bootstrap-Token: <the value you just put>" \
     -d '{"firstName":"...", "lastName":"...", "email":"...", "password":"..."}'
   ```
   This only ever works once (409s forever after). Additional admins go
   through `POST /api/admin/users` once logged in as one; if you're ever
   locked out entirely, `pnpm run seed:admin -- <email> <password>` in
   `apps/api` generates a `wrangler d1 execute` command as a fallback.

5. **Custom domain**: `nhtaxi.com` is already on this Cloudflare account, so
   nothing manual is needed. `wrangler.toml` already declares
   `api.nhtaxi.com` as a custom domain (L27/L29), and the first `wrangler
   deploy` creates the route and DNS record automatically. `app.` and
   `tracker.` are reserved by the existing Trackcar app, so don't reuse them
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
