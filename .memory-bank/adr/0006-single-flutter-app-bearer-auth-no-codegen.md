# ADR 0006: One Flutter app for all roles, Bearer tokens everywhere, hand-written models

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (decision locked during Faz 7 Wave 1; recorded here retroactively)

## Context
The client needs to serve passengers, drivers and the admin/owner. The API's `lib/session.ts` returns tokens in the response body only for `platform: ios|android`; `web` gets httpOnly cookies and `null` tokens, and `middlewares/csrf.ts` exempts Bearer requests entirely. The app also needs to run in a browser for quick testing (`gnncab-preview.pages.dev`).

## Decision
- **One Flutter app, role-based.** A single codebase renders the passenger, driver and admin shells; `router.dart` redirects by role, and the owner-operator sees both via a pure-UI `viewModeProvider` toggle (see ADR 0008). There is no separate React admin app — `apps/admin/` holds only a README; the admin panel was built into the Flutter app in Faz 9.
- **Bearer tokens on every platform, including web.** The app always registers as `ios`/`android` and uses Bearer tokens exclusively, so cookies and CSRF never enter the picture and there is one auth code path across all targets. `core/api_client.dart` (Dio) attaches the token and transparently refreshes on a 401. On web, `flutter_secure_storage` degrades to XSS-readable browser storage — **acceptable only because the web build is a dev/test preview, never the production passenger surface.** If web is ever promoted, revisit this.
- **No OpenAPI→Dart codegen.** Models are hand-written from the OpenAPI shapes (`models/*.dart`). The generator needs a Java toolchain and emits a large surface most of which we'd delete; hand-written models for the endpoints the app actually touches are smaller and easier to read. Revisit only if the model count grows a lot.

## Consequences
- The contract (`packages/contract`) and the Dart models must be kept in sync by hand. When a response schema changes, update the matching `models/*.dart` and its `fromJson`.
- Some rules are enforced twice and must stay in sync by hand — e.g. `Trip.canCancel`/`mustCallToCancel` mirrors `CUSTOMER_NON_CANCELLABLE` in `routes/trips.ts`, and `CURRENT_TERMS_VERSION` (contract) mirrors `termsVersion` (Flutter).
- The web preview is convenient but is not a security surface; the production passenger experience is the native build.

## Evidence
- `apps/mobile/lib/core/api_client.dart`, `router.dart`, `models/*.dart`
- `apps/api/src/lib/session.ts`, `middlewares/csrf.ts`
- `.memory-bank/changelog/verified-worklog.md` → "Faz 7 Wave 1", "Faz 9"
