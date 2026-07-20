# Pipeline & Backlog

## Active Sprint / Current State
- Phase 0-6 complete. (Admin reporting, FCM Push, Pricing models established).
- Cloudflare deployment pipeline is fully functional.

## Immediate Next Actions
- [ ] Phase 7: Mobile App Setup (Flutter).
- [ ] CI configuration for Flutter Android APK build + Artifact upload.

## Backlog
- Phase 8: Web Admin enhancements (Pages integration).
- Phase 10: Go-Live & Cutover from legacy Trackcar.
- Phase 7b: Flutter Web Preview deployment for quick testing.

## Blockers
- None.

## Suggested Validation Plan
- Ensure API typechecks pass: `pnpm run typecheck`
- Ensure tests pass: `pnpm run test`

## Converged Tasks (Pending) (Sentinel Skill /sentinel-converge )
- [ ] **Transaction Safety Fix (High Priority)**: Refactor `apps/api/src/routes/trips.ts` to wrap sequential `db.update` and `db.insert` queries (especially in `TRIP_COMPLETED` and `TRIP_CANCELLED` state transitions) within `db.batch()` to ensure atomicity on Cloudflare D1.
- [ ] **Archive Consistency Fix**: Update `.memory-bank/migration-map.md` to remove the excess `.spec/` subdirectories from the Archive Path column.
