# Audit: SRS & System Architecture

Summarized from the legacy SRS (originally archived at
`.archive/docs-migration/2026-07-19/srs_architecture_doc.md`; that folder was
retired once everything below was confirmed captured — see ADR 0001, ADR
0002, ADR 0010, and the `zones` note below).

## Core Purpose
Real-time ride dispatch and driver tracking platform supporting multiple cities.

## Actors & RBAC
- **Customer**: App user, requests rides, tracks driver via WebSockets.
- **Driver**: Linked `driver_profiles` 1:1 with `users`. Updates status, accepts/rejects rides, posts `LOCATION_UPDATE`s.
- **Admin**: Full access. Approves drivers, manages zones and pricing.
- **Auth**: JWT (HttpOnly cookies for web, Bearer tokens for mobile).

## Business Logic
- **Dispatch Engine**:
  - Finds `AVAILABLE` drivers within 10 miles (Haversine).
  - 60-second timeout for acceptance.
  - Max 3 redispatch attempts.
- **State Machines**:
  - `Trip`: REQUESTED -> DRIVER_ASSIGNED -> DRIVER_ACCEPTED -> DRIVER_EN_ROUTE -> DRIVER_ARRIVED -> TRIP_STARTED -> TRIP_COMPLETED.
  - `Driver`: OFFLINE, AVAILABLE, RESERVED, BUSY.

## Architecture & Real-Time (Refined for Cloudflare)
- **WebSockets**: 60-second limit (max 30 updates).
- **Concurrency Protection**: Database transactions via Drizzle ORM to prevent race conditions during dispatch.
- **Durability**: Durable Objects handle state tracking and alarms (dispatch timers).

## Database Relationships
- SQLite (Cloudflare D1).
- `trips` linked to `customers` and `drivers`.
- `trip_events` maintains audit trails of state changes.
- Critical indexes applied for lookup performance (e.g., `idx_driver_profiles_status`).
- **`zones` + `driver_zone_assignments` (Optional/Admin in the original SRS)**:
  a polygon-geofence layer letting an admin restrict which drivers serve
  which region, `driver_zone_assignments` as the M:N join. Never wired to
  anything in this rebuild (single service area, no multi-city need) —
  **deleted in migration 0011** after user confirmation. Preserved here as
  the design reference if a future multi-city build wants it back.
