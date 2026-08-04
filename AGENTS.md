# AGENTS.md — canonical agent onboarding for NH Taxi

This is the entry point for **any** AI agent working on this repo (Claude,
Gemini, Codex, DeepSeek, Antigravity, Cursor, …). `CLAUDE.md` and `GEMINI.md`
at the repo root just redirect here. Read this file, then the two files under
"Start here", and you can continue exactly where the last agent left off.

---

## What this project is

**NH Taxi** — a ride-dispatch platform for **GNN LLC**, a ~10–20 driver taxi
operation in **North Conway, New Hampshire, USA**, branded to match its domain
`nhtaxi.com`. Deliberately small and lean: the whole thing runs on
**Cloudflare's free tier (~$0/mo)**. Drivers are independent owner-operators
who pay GNN LLC rent for app time plus commission on referred jobs, and are
paid by passengers in **cash** (no in-app payment). The product language is
**Turkish** (chat with the user) but the **codebase, UI copy, commits and docs
are English**.

**"GNNcab" was the working name during the rebuild** — still visible in the
Cloudflare Worker/D1/R2 resource names and the Flutter web preview subdomain
`gnncab.nhtaxi.com`, kept deliberately, purely cosmetic, see ADR 0009.
Nothing a user sees — app UI, emails, legal terms, the OpenAPI title — says
"GNNcab" anymore; the Dart package and Android `applicationId` are `nhtaxi` /
`com.nhtaxi.app`.

**Repo identity, current as of 2026-07-26**: the GitHub repo is
**public** at `github.com/BigDesigner/project-nhtaxi` (renamed twice:
`GNNcab-stack` → `gnncab-nhtaxi` → `project-nhtaxi`; old URLs auto-redirect
for a while but don't rely on that). The local clone's folder is also named
`project-nhtaxi` now, matching. Being public changes the stakes on
secrets — see rule 7 below and `.githooks/pre-commit`.

## Start here (read these two first)

1. **`.memory-bank/changelog/verified-worklog.md`** — the single best file to
   reconstruct context. Every phase, why each non-obvious decision was made, and
   how the tricky mechanisms actually work. Read its "How Things Work" and
   "Known Incomplete Work" sections in full.
2. **`.tasks/handoff.md`** — the latest snapshot: current commit, test counts,
   what changed last, what to do next, and what only the user can do.

Then, as needed:
- **`.memory-bank/adr/`** — Architecture Decision Records. The load-bearing
  "why" behind the stack and the money/pricing/atomicity/auth decisions.
- **`.specs/`** — governance: `constitution.md`, `boundary-conditions.md`
  (both **read-only** — do not edit), `bootstrap.md` (setup).
- **`.tasks/pipeline.md`** — backlog. `.memory-bank/bugs/bug-list.md` — open bugs.
- **`README.md`** — one-time Cloudflare setup + dev commands.

## Architecture at a glance

```
apps/api/       Hono on Cloudflare Workers — REST + WebSocket. D1 (SQLite) via
                Drizzle, R2 (driver docs, avatars), two Durable Objects
                (DispatchCoordinator = per-trip dispatch + Alarm; LocationHub =
                live position fan-out over WebSocket). Cron: stale-session sweep.
apps/mobile/    ONE Flutter app for all roles (passenger / driver / admin),
                Riverpod + go_router + Dio. Also the admin panel (no separate
                web-admin app; apps/admin/ is just a README).
packages/db/    Drizzle schema (D1/SQLite) + migrations.
packages/contract/  Shared zod schemas — the source the OpenAPI doc is
                generated from, and the shape the Flutter models mirror by hand.
```
Live: API `api.nhtaxi.com`, web preview `gnncab-preview.pages.dev`.

## Non-negotiable rules (violating these breaks money, security, or trust)

1. **Commit anonymity (CRITICAL).** Never add `Co-Authored-By`, AI attribution,
   or any signature/trailer to git commits — messages stay anonymous.
2. **D1 has no interactive transactions.** Drizzle `.transaction()` silently
   no-ops. Any all-or-nothing write sequence MUST be a single `db.batch([...])`.
   See ADR 0005.
3. **Migrations: `ADD COLUMN` is safe; table rebuilds are dangerous.** Prefer
   plain `ALTER TABLE … ADD COLUMN` (no `CHECK` for codebase-only columns).
   A real rebuild goes in its **own** migration, hand-written, children
   repointed **before** the drop; seed `test/seed-migration-check.sql` first.
   Always smoke-test remote D1 after — local success proves nothing. ADR 0005.
4. **Fares use real road distance and fail closed.** `lib/routing.ts` (OSRM,
   `lng,lat` order!). Never fall back to a straight-line approximation — return
   503 instead. ADR 0004.
5. **Commission follows `trips.referralSource`, never `origin`.** GNN takes a
   cut only on referred jobs; rent pays for ordinary dispatch. ADR 0003.
6. **No API path grants `admin` or `isAdmin`.** Escalation is impossible by
   design; new admins/dual-role come from the bootstrap endpoint (once) or a
   deliberate manual DB change. ADR 0008.
7. **Secrets never touch chat or the repo — and the repo is now public.**
   JWT/FCM/Brevo/encryption keys are set by the user with
   `wrangler secret put`. Never ask for or print a secret. A
   `.githooks/pre-commit` hook blocks obviously-secret-shaped commits
   (credential filenames, private-key blocks, known token prefixes,
   real-looking `KEY=<value>` assignments) as a backstop, and GitHub's own
   secret scanning + push protection is enabled on the repo — but don't
   rely on either as the only line of defense; review your own diff first.
8. **Plan before code on anything non-trivial.** The user works "önce plan,
   sonra kod" (plan first). For a sizeable change, present the plan and wait.
9. **Verify before claiming done.** `pnpm run typecheck` + backend vitest +
   `flutter analyze`/`flutter test`, then commit → watch CI (`Deploy` runs on
   every push to `main`, no path filter; `Mobile` is path-filtered to
   `apps/mobile/**`, so it only fires when Flutter changed) → live smoke.

## Memory discipline — update after every commit

The memory bank is only useful if it stays true. **After each commit that
changes behavior** (not pure-refactor noise), before moving on:

1. Append a short, honest entry to
   **`.memory-bank/changelog/verified-worklog.md`** — what changed and *why*,
   plus any non-obvious mechanism, in the existing voice.
2. Refresh **`.tasks/handoff.md`** — current commit hash, test counts, what
   changed, next action, user-owned items.
3. If the commit embodies a real architectural decision, add an **ADR** under
   `.memory-bank/adr/` (next number) and link it from the changelog.
4. Keep the **Validation Status** test counts in the changelog current.
5. Update `.memory-bank/active-session.json` `last_commit`.

A committed reminder hook lives at `.githooks/post-commit`; enable it once per
clone with `git config core.hooksPath .githooks`. It only prints a reminder —
the actual prose update is the agent's job (a script can't write the "why").

## Working agreements (style)

- No fluff — skip apologies, congratulations, and preamble. Output
  production-ready code and direct analysis. On an error, acknowledge briefly
  and give the corrected version.
- TypeScript monorepo: run `pnpm install` + `pnpm run typecheck` from the root
  for workspace coherence. After a schema change: edit
  `packages/db/src/schema`, then `pnpm run db:generate` in `apps/api`, commit
  the generated `migrations/*.sql`.
- Cloudflare Workers run in a V8 isolate — no Node stdlib (`fs`, `child_process`,
  the Node `crypto` module); use Web Crypto (`crypto.subtle`) and `fetch`.
- Some rules are enforced in two places and must be kept in sync by hand:
  `Trip.canCancel`/`mustCallToCancel` ↔ `CUSTOMER_NON_CANCELLABLE`
  (`routes/trips.ts`); `CURRENT_TERMS_VERSION` (contract) ↔ `termsVersion`
  (Flutter). Flutter models are hand-written from the contract (no codegen —
  ADR 0006), so a response-shape change means updating the matching
  `models/*.dart`.

## Commands

```bash
pnpm install
pnpm run typecheck                         # whole workspace
cd apps/api && pnpm vitest run             # backend tests (real D1/DO)
cd apps/mobile && flutter analyze && flutter test
pnpm --filter @gnncab/api run dev          # local wrangler dev :8787
cd apps/api && pnpm run db:generate        # after a schema change
```

## Things only the user can do (do not attempt)

- `wrangler secret put` for `FCM_SERVICE_ACCOUNT_KEY`, `BREVO_API_KEY` (push &
  email no-op silently until set — `BREVO_API_KEY` may already be set; can't
  be verified from a fresh clone without a real send, see handoff.md), and
  rotating others.
- Move `ROUTING_BASE_URL` off the public OSRM demo before real volume.
- `info@nhtaxi.com` is **already** the live admin account (`role: "admin"`) —
  that's not a to-do. The actual optional item is converting it to the dual
  role (`role:"driver", isAdmin:true`) so the same login could also drive —
  a deliberate one-off DB change, only relevant if wanted (ADR 0008).
- Firebase project + `flutterfire configure` to actually deliver push.
- Local `wrangler` CLI may not be authenticated against the Cloudflare
  account that owns this project's Worker/D1 — check before assuming a
  `wrangler d1`/`secret list` command will reach production; see
  `.tasks/handoff.md` for the workaround (a `workflow_dispatch` GitHub
  Action reusing the repo's own `CLOUDFLARE_API_TOKEN`).
