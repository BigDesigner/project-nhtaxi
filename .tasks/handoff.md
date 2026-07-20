# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `e40b4c6` — "Add the driver map and settle post-match cancellation"
- **Worktree status**: Clean
- **What changed**:
  - Driver map (`GET /api/drivers`, `DirectoryDriver` model, `DriversScreen`)
    so passengers can browse the on-duty fleet and request a specific driver.
  - Preferred-driver dispatch: `POST /api/trips` accepts `preferredDriverId`;
    `DispatchCoordinator` offers that driver once, then falls back to nearest.
  - Post-match cancellation narrowed to free-until-`DRIVER_EN_ROUTE`, then a
    "call dispatch" card replaces the cancel button. Assigned driver gets a
    push on any cancellation.
  - Full detail on how both work: see
    `.memory-bank/changelog/verified-worklog.md` ("How Things Work" section).
- **What was verified**:
  - Backend 95/95 vitest, `pnpm run typecheck` clean.
  - Mobile 17/17 Flutter tests, `flutter analyze` clean.
  - CI `Deploy` + `Mobile` workflows green on this commit.
  - Live smoke test against `api.nhtaxi.com`: `GET /api/drivers` → 200 (empty
    list, expected — no driver app exists yet to register real drivers), 401
    when unauthenticated.
- **Known failures**: none currently open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && npx vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**:
  - Build the driver app (registration incl. vehicle/plate/photo, the
    Online/Offline toggle, accept/reject flow, balance + footprint view) —
    this is also the only way to get real drivers into the new map to test
    it against.
  - Phase 7 Wave 3: wire the Flutter client to the existing LocationHub
    Durable Object for live driver position updates (map is currently a
    static snapshot).
  - User-owned: attach `gnncab.nhtaxi.com` as a custom domain on the
    `gnncab-preview` Pages project; supply the Firebase service-account key
    so push notifications go live.
- **Files touched** (this batch):
  - `apps/api/src/routes/drivers_directory.ts` (new),
    `apps/api/src/routes/drivers-directory.test.ts` (new)
  - `apps/api/src/lib/dispatch.ts`, `apps/api/src/durable-objects/dispatch-coordinator.ts`
  - `apps/api/src/routes/trips.ts`, `apps/api/src/lib/trip-notifications.ts`, `apps/api/src/app.ts`
  - `packages/contract/src/schemas/drivers-directory.ts` (new), `packages/contract/src/schemas/trips.ts`, `packages/contract/src/index.ts`
  - `apps/mobile/lib/models/directory_driver.dart` (new), `apps/mobile/lib/models/trip.dart`
  - `apps/mobile/lib/features/passenger/drivers/` (new: `drivers_controller.dart`, `drivers_screen.dart`)
  - `apps/mobile/lib/features/passenger/booking/booking_controller.dart`, `booking_screen.dart`
  - `apps/mobile/lib/features/passenger/active_trip_screen.dart`, `passenger_home_screen.dart`, `router.dart`
  - `apps/mobile/lib/widgets/help_card.dart`
