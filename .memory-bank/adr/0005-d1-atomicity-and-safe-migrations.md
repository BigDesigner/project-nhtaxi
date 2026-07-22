# ADR 0005: D1 atomicity via db.batch(), and safe-migration discipline

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (learned during Faz 5c and every table rebuild since; recorded here retroactively)

## Context
Cloudflare D1 is SQLite reached over HTTP. Two of its properties bit this project hard and cost real remote-only failures that never reproduced under local `wrangler dev`.

## Decision

### 1. `db.batch()` is the only atomicity primitive
Drizzle's `.transaction()` **silently no-ops on D1** — there are no interactive transactions. Any sequence of writes that must be all-or-nothing (a trip status change plus its side effects, a rating insert plus the recomputed driver average, a commission charge plus the balance it feeds) must be expressed as a single `db.batch([...])`. A partial write here means money is wrong: a rating that counted but didn't move the average, a completed trip whose commission row didn't land.

### 2. Migrations: plain `ADD COLUMN` is safe; table rebuilds are dangerous and go alone
Every migration that ever failed on remote D1 was a **table rebuild** (drizzle-kit's `CREATE new / INSERT..SELECT / DROP old / RENAME`). They failed remotely and passed locally because D1 runs each migration statement as a separate HTTP request, so `PRAGMA foreign_keys=OFF` does not necessarily survive between statements, and because local test DBs had parent rows but no *child* rows to violate a foreign key.

Rules that follow:
- Prefer plain `ALTER TABLE … ADD COLUMN`. A column only this codebase ever writes does **not** need a SQL `CHECK`/enum constraint — skipping it keeps the migration in the safe category (this call was made for `paymentMethod`, `path_verification`, `is_admin`, `rating_count`).
- When a rebuild is truly unavoidable (a `CHECK` on an existing column must change, or a table must be dropped): **hand-write it**, give it **its own migration alone**, and **repoint every child table at the new parent *before* dropping the old one**. This is what made `0007` (add `DRIVER_REFERRAL`) and `0011` (drop `zones`) apply cleanly.
- **Seed child rows before testing any rebuild.** `apps/api/test/seed-migration-check.sql` exists because "it worked locally" was measuring nothing when local had no child rows. Run it first.

## Consequences
- New multi-write logic must consciously choose `db.batch()`; a reviewer should treat sequential awaited writes as a bug until shown otherwise.
- The per-city columns (`trips.city_id`, `pricing_config.city_id`, …) are kept even though unused, precisely because removing them means a `trips`/`pricing_config` rebuild — the exact dangerous op — for no benefit in a single-market business.
- After any migration, run a live smoke against remote D1; local success is not evidence.

## Evidence
- `apps/api/src/routes/trips.ts`, `ratings.ts`, `referral_trips.ts` (`db.batch` sites)
- `apps/api/migrations/0007_*.sql`, `0011_*.sql`, `test/seed-migration-check.sql`
- `.memory-bank/changelog/verified-worklog.md` → "Faz 5b/5c", "Migration 0007", "Defined-but-dead"
