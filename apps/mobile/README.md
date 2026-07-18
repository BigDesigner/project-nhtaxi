# apps/mobile (placeholder)

Flutter app — Faz 7 per [.spec/rebuild_plan.md](../../.spec/rebuild_plan.md).

One app, role-based (L7): passenger, driver, and admin screens behind a
single login (L15). Talks to `api.nhtaxi.com` with Bearer access/refresh
tokens (L11) — no CORS/cookie concerns on mobile. Maps via `flutter_map` +
OpenStreetMap tiles (L12).

CI builds a debug Android APK as a workflow artifact for emulator testing
before any store release; iOS and signed release builds come later (L26).
