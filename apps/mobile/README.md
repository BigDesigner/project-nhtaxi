# GNNcab mobile

Single Flutter app for all three roles (L7). Wave 1 implements auth + the
passenger shell; map/booking and live tracking follow in later waves.

## Running locally

The app talks to the Worker API. For the fast dev loop, run the API locally
and point the app at it:

```bash
# terminal 1 — the API (from apps/api)
pnpm run dev                      # wrangler dev on :8787

# terminal 2 — the app (from apps/mobile)
flutter run -d chrome --web-port=5174 \
  --dart-define=API_BASE_URL=http://localhost:8787
```

**The port is not arbitrary.** Flutter Web is browser-hosted, so its requests
are CORS-checked even though the app authenticates with Bearer tokens rather
than cookies. `http://localhost:5174` is the origin allowed by the API's dev
CORS list in `apps/api/src/app.ts` — use another port and every request fails
with a CORS error that looks like a network outage.

Without `--dart-define`, the app defaults to production (`api.nhtaxi.com`),
which is correct for CI-built artifacts but will be CORS-blocked from
localhost. That's deliberate: production should not trust local origins.

## Auth model

The API only returns tokens in the response body for `platform: ios|android`;
`web` gets httpOnly cookies instead (see `apps/api/src/lib/session.ts`). This
app **always identifies as a native platform, including on Flutter Web**, so
there is exactly one auth code path across every target: Bearer tokens, never
cookies — which also means the API's CSRF middleware never applies to us.

Tokens live in `flutter_secure_storage` (Keychain / Android Keystore). On web
that degrades to browser storage and is XSS-readable; acceptable only because
the web build is a dev/test preview (L32), never the production passenger
surface.

## Platforms

`android` and `web` are checked in. **`ios/` is intentionally absent** — the
Flutter tool cannot manage its `ephemeral/` directory on Windows and breaks
every command, and iOS is deferred anyway (L26: macOS runners burn the free
Actions quota ~10x). Regenerate it whenever iOS work starts:

```bash
flutter create --platforms=ios .
```

## CI

`.github/workflows/mobile.yml` runs analyze + tests and builds a debug APK
(including the x86_64 ABI so it runs on an emulator) as a downloadable
artifact. No store signing yet — L26 stage 1.
