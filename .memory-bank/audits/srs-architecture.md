# Audit: SRS & System Architecture

Summarized from legacy `.spec/srs_architecture_doc.md`.

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
