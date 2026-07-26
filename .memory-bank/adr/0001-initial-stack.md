# ADR 0001: Initial Stack Selection

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-19

## Context
The project needs to scale effectively while prioritizing cost efficiency (specifically aiming for a $0 infrastructure run cost on Cloudflare's free tier). The previous architecture was designed for 10,000 drivers and included heavy services (Redis, PostGIS, BullMQ, multi-worker setups) which are overkill for the actual target of 10-20 drivers.

## Decision
- **Backend Framework**: Hono (running natively on Cloudflare Workers).
- **Database**: Cloudflare D1 (SQLite) paired with Drizzle ORM.
- **Storage**: Cloudflare R2 for driver document uploads (write-once, encrypted).
- **Real-time & Dispatch**: Durable Objects (using WebSockets for real-time tracking and Alarms for dispatch timers).
- **Frontend Admin**: React app hosted on Cloudflare Pages.
- **Mobile**: A single Flutter app handling all roles (Customer, Driver, Admin).
- **Push Notifications**: Firebase FCM via HTTP v1 API directly from the Worker.

## Consequences
- Operations are bound to Cloudflare ecosystem constraints (e.g., Workers execution limits), though these are ample for the target scale.
- We must handle file encryption on the application layer (envelope encryption) before storing sensitive driver documents in R2.
- No Node.js runtime on the backend; all libraries must be compatible with the V8 isolate environment (Cloudflare Workers).

## Evidence
- `.memory-bank/migration-map.md` — the original rebuild plan's locked
  decisions L2, L6, L7, L10 (the source doc was retired once fully migrated).
- `package.json`, `pnpm-workspace.yaml`.

> Note (2026-07-22): the React web-admin plan (Faz 8) was not built as a separate app — `apps/admin/` holds only a README and the admin panel lives in the single Flutter app (see ADR 0006, Faz 9). Everything else here is as built.
