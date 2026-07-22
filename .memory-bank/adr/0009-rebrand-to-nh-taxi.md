# ADR 0009: Rebrand from "GNNcab" to "NH Taxi", partially

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22

## Context
"GNNcab" was the working name chosen during this rebuild. It was never the business's actual brand: the operator's real domain and marketing identity is `nhtaxi.com` ("NH Taxi"). The user asked directly whether renaming the app to NH Taxi would be difficult, and — separately — whether a combined name like "GNNcab - NH Taxi" made sense.

Two things made the decision easy:
1. **No app-store listing exists yet** (CI only produces a debug APK; there is no Play Store/App Store presence). This is the one and only window where the Android `applicationId` and the Flutter package name can be changed for free — once a real store listing exists, changing `applicationId` means abandoning it and starting a new listing from zero installs/reviews.
2. **A combined name has no upside here.** Patterns like "Twitter (X)" exist to bridge recognition for an *already-known* name. "GNNcab" was never public-facing, so there is no recognition to preserve — a combined name would only be longer, less searchable, and read as an unfinished rebrand.

## Decision
Rebrand in two layers, decided and executed together:

1. **Every user-visible surface → "NH Taxi".** Flutter UI strings (app title, shell headers, login screen), the legal terms documents (both `CURRENT_TERMS_VERSION` and Flutter's `termsVersion` bumped to 2026-07-22 alongside the wording, per the project's own "change the wording, change both" rule), OS-level labels (`AndroidManifest.xml` `android:label`, `web/manifest.json`, `web/index.html` `<title>`), transactional email subject/body/sender name, and the OpenAPI document title. "GNN LLC" is untouched everywhere — it is the legal entity operating the app, not the product's brand name, and remains correct as-is.
2. **App identity → `nhtaxi`.** Android `applicationId`/`namespace`: `com.gnncab.gnncab` → `com.nhtaxi.app` (with `MainActivity.kt` moved to the matching package folder). Flutter/Dart package name: `gnncab` → `nhtaxi` (`pubspec.yaml` + all `package:gnncab/...` imports, confined to `test/` — `lib/` already used relative imports throughout).
3. **Explicitly NOT renamed, by the user's own instruction — purely cosmetic, kept on purpose:**
   - The git repo folder name.
   - Cloudflare resource names: the Worker (`gnncab-api`), the D1 database (`gnncab`), the R2 bucket (`gnncab-driver-documents`), the Pages project (`gnncab-preview`).
   - The Flutter web preview subdomain `gnncab.nhtaxi.com` — this is slated to become `app.nhtaxi.com` later, once the legacy Trackcar app (which currently reserves `app.`/`tracker.`, per the original SRS) is retired. That is a separate, future, user-driven task, not part of this rebrand.
4. Third-party-facing identification strings that named "GNNcab" were also updated for consistency, even though not seen by end users directly: the Nominatim/OSRM `User-Agent` headers (`lib/geocoding.dart`, `apps/api/src/lib/routing.ts`).

## Consequences
- Nothing a passenger, driver, or admin sees says "GNNcab" anymore. The only surviving "gnncab" strings are internal/cosmetic Cloudflare resource identifiers and the temporary preview subdomain, all invisible to end users.
- A future agent or contributor who sees `gnncab-api`, database name `gnncab`, or `gnncab.nhtaxi.com` should not "fix" these — they are deliberately kept, not missed. See the note in `AGENTS.md` and the root `README.md`.
- No migration, no data change, no downtime — this was a text/identifier rename only. 204/204 backend tests and 103/103 Flutter tests passed unchanged in behavior.
- If iOS is ever added (`flutter create --platforms=ios .`, per `apps/mobile/README.md`), its bundle identifier must be set to `com.nhtaxi.app` to match Android — there was no `ios/` directory to update at the time of this ADR.

## Evidence
- `apps/mobile/pubspec.yaml`, `android/app/build.gradle.kts`, `android/app/src/main/kotlin/com/nhtaxi/app/MainActivity.kt`, `android/app/src/main/AndroidManifest.xml`, `web/index.html`, `web/manifest.json`
- `apps/mobile/lib/legal/terms.dart`, `apps/mobile/lib/main.dart`, `router.dart`, `features/auth/login_screen.dart`, `features/auth/driver_signup_screen.dart`, `features/driver/driver_shell.dart`, `features/passenger/passenger_shell.dart`
- `packages/contract/src/schemas/legal.ts` (`CURRENT_TERMS_VERSION`)
- `apps/api/src/lib/email-templates.ts`, `lib/email.ts`, `lib/routing.ts`, `src/app.ts` (OpenAPI title)
- `.github/workflows/mobile.yml` (artifact name)
