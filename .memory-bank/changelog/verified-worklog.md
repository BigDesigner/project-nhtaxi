# Verified Worklog

Chronological record of what's built, why key decisions were made, and how
the non-obvious mechanisms actually work. Update this after each meaningful
batch of work — this is the file to read to reconstruct context after a gap.

## Completed Phases

One sentence per distinct piece of work, in build order. Test/deploy/smoke
passes for each phase are implied and not re-stated per line unless they
found something worth remembering on their own.

### Faz 0 — Foundations
- Set up the pnpm-workspace monorepo (`apps/`, `packages/`) with a Cloudflare
  Workers + Hono API skeleton.
- Drafted the initial D1 schema with Drizzle (sqlite dialect) and wired the
  real D1 database id into `wrangler.toml`.
- Stood up skeletons for the two Durable Objects the rest of the project
  builds on (dispatch coordination, driver location tracking).
- Created the `packages/contract` package (zod schemas + OpenAPI generation)
  as the single source of truth shared between API and clients.
- Built the GitHub Actions CI/CD workflows (typecheck, test, deploy) and
  fixed an early bug where `secrets` context isn't allowed in job-level `if:`.

### Faz 1 — Identity & RBAC
- Implemented PBKDF2 password hashing via Web Crypto, capped at 100,000
  iterations after discovering higher counts 500'd on the real Workers edge
  (local `wrangler dev` didn't reproduce it).
- Built JWT access/refresh token issuance and the shared `lib/session.ts`
  helper so every auth-adjacent route issues sessions identically.
- Added auth cookie handling + CSRF protection, and the
  `authenticate`/`requireRole` middleware every protected route depends on.
- Added the audit log helper (`lib/audit.ts`) used across all money- and
  status-changing routes.
- Wrote the auth contract schemas and shipped `register`/`login`/`refresh`/
  `logout`/`me` routes, fixing a CI-only failure where `JWT_SECRET` was
  undefined without a checked-in `.dev.vars`.
- Added a self-locking `POST /api/admin/bootstrap` endpoint so the very first
  admin account can be created without a chicken-and-egg problem, then locks
  itself once an admin exists.

### Faz 2 — Profiles & Admin
- Added contract schemas for driver/customer profiles, admin actions, and
  pricing.
- Built self-service driver and customer profile routes, plus admin routes
  for managing users, drivers, cities, and pricing.
- Wired every route into `app.ts` with `requireRole` gating and validated the
  whole surface with integration tests against real D1/R2 (not mocks).

### Faz 3 — Trips & Dispatch
- **3a**: trip contract schemas, the haversine/fare library, and the trip
  request + 11-state status machine (`routes/trips.ts`) with a simple
  inline "assign once, TIMEOUT if nobody's around" dispatch.
- **3b**: replaced that inline dispatch with `DispatchCoordinator`, a Durable
  Object (one instance per trip via `idFromName`) that owns a 60-second
  driver-acceptance Alarm and automatically tries the next nearest driver if
  the current one doesn't respond in time.

### Faz 4 — Live Location
- Built `LocationHub`, a Durable Object that fans out driver location
  updates over WebSocket (Hibernation API) to whoever's watching a trip, and
  wired the `/api/ws` route + its `wrangler.toml` binding.

### Faz 5 — Reporting
- Added contract schemas for reports/audit/earnings, a CSV export helper
  (`lib/csv.ts`), admin report + audit-log routes, and a driver earnings
  endpoint.

### Faz 5b/5c — Cash-Only Business Pivot
Mid-project the business model changed: Stripe/in-app payment was dropped
indefinitely in favour of cash collected in person every 10-20 days, replaced
by two driver-owed revenue streams for GNN LLC.
- **5b (usage-time fee)**: added `driver_sessions`/collections schema and
  pricing columns, the `lib/driver-sessions.ts` core logic that opens/closes
  a billable session whenever a driver's app leaves/enters OFFLINE, admin
  billing + driver balance endpoints, a cron sweep that closes stale
  sessions so a driver who force-quits doesn't run up an unbounded charge,
  and restricted `PAYMENT_METHODS` to `["cash"]` at the contract layer only
  (DB CHECK constraint deliberately left wide for a trivial future reversal).
- **5c (admin-assigned commission)**: added trip origin/commission/guest
  fields and a nullable dropoff (an admin-assigned trip's destination may be
  unknown at booking time), admin trip assignment/reassignment endpoints, a
  driver-commissions report, and made every trip status write atomic via
  `db.batch()` after finding `drizzle`'s `.transaction()` silently no-ops on
  D1 (no interactive transactions — `db.batch()` is the only real atomicity
  primitive).
- Along the way, fixed two remote-only D1 migration failures that never
  reproduced locally: drizzle-kit generating an `INSERT...SELECT` against
  columns that didn't exist yet on the old table, and a foreign-key
  violation from dropping `trips` before its children were repointed.

### Faz 6 — Push Notifications
- Added push-token contract schemas and the `push_tokens` table/migration,
  token registration routes, and `lib/fcm.ts` — FCM HTTP v1 push signed with
  Web Crypto RS256 JWTs directly (no Node Firebase SDK, since Workers can't
  run it).
- Wired notifications into every customer-facing trip status transition and
  into driver assignment; deployed live but the code silently no-ops until a
  real `FCM_SERVICE_ACCOUNT_KEY` is supplied (user-owned step, still
  pending).

### Faz 7 Wave 1 — Flutter Foundation
- Added the fare-estimate backend endpoint (`POST /api/trips/estimate`) and
  opened CORS for Flutter Web.
- Scaffolded the Flutter app and its dependencies, then built the core layer
  (API config, secure token store, Dio-based API client with Bearer-token
  auth used identically on every platform, including web — no cookies).
- Built the auth feature (login/signup) and hand-written models from the
  OpenAPI shapes.
- Built the router with role-based redirect and the first passenger home
  screen.
- Added the CI Android APK build workflow.
- Verified the whole wave live against `api.nhtaxi.com` running in Chrome.

### Faz 7 Wave 2 — Booking
- Added the Nominatim geocoding service (debounced to respect its ~1 req/s
  policy; the User-Agent identification header only works on native
  builds, browsers block it).
- Built the booking screen (map + address search + fare preview) and the
  request-trip + active-trip screens.
- Deployed the first public web preview and later pointed it at
  `gnncab.nhtaxi.com` (Cloudflare Pages project `gnncab-preview`), adding an
  idempotent `wrangler pages project create` step after discovering
  `pages deploy` doesn't create the project itself.

### Passenger Testing Round 1 — 4 Fixes
- Fixed unauthenticated login silently wiping the real error instead of
  showing "no such user" (a stray token-refresh attempt was swallowing it).
- Made pickup auto-detect from device location with a draggable map-pin
  fallback when permission is refused or the passenger wants to nudge it.
- Replaced client-side polling for a driver with the server-side
  `DispatchCoordinator` re-search loop (Alarm-driven, 15 sweeps × 60s) plus a
  synced countdown UI, since client polling couldn't survive the app being
  closed.
- Fixed a cancelled trip not actually rendering as cancelled anywhere in the
  UI.

### Passenger Testing Round 2 — 9 Fixes
- Reworded search-in-progress copy to lead with plain language ("we're
  finding you a driver") instead of raw attempt/countdown numbers.
- Made the "Having trouble?" help card actually tappable, dialling dispatch
  directly with a clipboard-copy fallback where no dialer exists (e.g.
  desktop browsers).
- Colour- and icon-coded trip status (blue search / green matched-or-done /
  red cancelled-or-timed-out) so status doesn't rely on colour alone.
- Fixed stale trip state after navigating back to the home screen by
  refreshing on shell mount and on Home-tab reselect, without blanking the
  visible list.
- Added a thin progress bar during refreshes instead of a blank/loading
  screen, so a slow connection doesn't look broken.
- Added a driver map so passengers can browse the on-duty fleet and request
  a specific driver by name — see "How Things Work" below for the dispatch
  design behind it (item #6).
- Narrowed post-match cancellation rules instead of the originally-proposed
  driver-approval gate — see "How Things Work" below (item #7).
- Added footer navigation (Home/Profile/Settings) with icon-based tabs.
- Added a sign-out confirmation dialog instead of signing out on a single tap.

### Faz 8 — Driver App
Built almost entirely against endpoints that already existed (`/api/driver/*`
and the shared trip routes), so this wave was a Flutter build rather than new
backend work.
- Driver sign-up screen (`/signup/driver`, reached from the login screen)
  collecting vehicle make/model/colour/plate/year — all optional, because
  getting someone signed up beats a complete record, and the home tab nags
  for whatever is missing.
- Driver shell with Jobs / Balance / Profile tabs.
- An online/offline switch that states the per-minute charge out loud, blocks
  going offline mid-job, and explains when an unverified account can't go
  available.
- Job flow with one action at a time: accept or decline an offer, then "I'm on
  my way" → "I've arrived" → "passenger is in the car" → "dropped off".
- Commission disclosure before accepting an office-assigned job, with the
  fare, GNN LLC's cut and the driver's take-home spelled out — accepting is
  never the moment they learn what it costs.
- Job detail screen with a reference map and hand-off to the driver's own
  navigation app (`geo:` intent, https fallback for iOS/web).
- Balance tab framed as "what I owe" rather than earnings (cash never touches
  the system), broken down by usage fee vs commission, plus the session
  footprint listing which days and hours they were online and what each cost.
  Sessions the server force-closed are labelled, so an unexplained charge
  can't turn into a phone call.
- Vehicle details editable from Profile, since that's what the passenger
  driver map renders.

## Known Incomplete Work

- **Driver profile photo** — driver sign-up collects vehicle details but not
  an avatar. `DirectoryDriver.photoUrl` exists end to end (API response,
  Dart model, both UIs) and is always `null` until an upload path is built.
  Needs a decision: driver documents live envelope-encrypted in R2 and are
  admin-only, but a profile photo is shown to passengers, so it needs its own
  semi-public storage and serving route rather than reusing that pipeline.
- **Metered fare from the actual trip** — the driver already marks "passenger
  is in the car" (TRIP_STARTED) and "dropped off" (TRIP_COMPLETED), but the
  final fare still just copies the booking estimate
  (`finalFareCents = estimatedFareCents` in `routes/trips.ts`). Making it
  reflect what actually happened needs a decision on the basis: time elapsed,
  distance really travelled (from LocationHub's position stream), or both.
  The passenger-side quote is already presented as a floor with a +10%
  ceiling precisely so this can move without breaking a promise.
- **Admin app** — still a placeholder. Everything it needs exists server-side
  (reports, cash collection recording, pricing, driver verification), so this
  is a Flutter/web build rather than new backend work. Note drivers cannot go
  AVAILABLE until an admin verifies them, so onboarding a real driver
  currently requires an API call by hand.
- **Phase 7 Wave 3**: WebSocket live driver-position updates in the app
  (LocationHub DO already exists server-side; the Flutter client doesn't
  consume it yet — the driver map currently shows a static snapshot,
  refreshable by pull/tap only).
- **Firebase service-account key** not yet supplied — push notifications are
  wired and deployed but silently no-op.
- **Custom domain** `gnncab.nhtaxi.com` → `gnncab-preview.pages.dev` needs to
  be attached in the Cloudflare dashboard (user-owned step; CORS is already
  configured for it).
- Driver sign-up doesn't collect a profile photo yet — `DirectoryDriver.photoUrl`
  exists in the API response and is wired through the Flutter model/UI, just
  always `null` until driver registration adds an avatar upload.

## How Things Work — Non-Obvious Mechanisms

### Server-side driver search retry (replaces old client polling)
`DispatchCoordinator` (Durable Object, one instance per trip via
`idFromName`) owns a single Alarm slot with a `phase` discriminator
(`awaiting-driver` vs `searching`) since one Alarm can't otherwise
distinguish "the assigned driver went quiet" from "time to sweep again".
One sweep per minute (`SEARCH_RETRY_INTERVAL_MS`), 15 sweeps max
(`MAX_SEARCH_ROUNDS`), then the trip becomes `TIMEOUT` and the passenger can
`POST /api/trips/{id}/retry` to start over. The Flutter countdown renders
from the server's `nextSearchAt` timestamp, not a local timer, so multiple
screens showing the same trip always agree.

### Preferred-driver dispatch (testing round 2, item #6)
Passenger picks a driver off a map (`GET /api/drivers`); `POST /api/trips`
accepts an optional `preferredDriverId`. `DispatchCoordinator` stores it and
offers that driver **first, exactly once** — cleared from state whether they
accept, decline, or turn out to be already gone — then falls through to the
ordinary nearest-available search. This was a deliberate choice ("önce
seçilen, sonra en yakın"): re-offering the same unreachable driver every
sweep would strand a passenger who picked someone no longer around.

`GET /api/drivers` returns a deliberately narrow projection of
`driver_profiles` — name, status, vehicle, plate, phone, position, and a
"free in ~N min" estimate for BUSY drivers (only computed when a trip has
actually started and enough data exists to derive it; otherwise `null`
rather than a guessed number the passenger might wait on). Licence numbers,
ratings, and verification state are excluded on purpose. OFFLINE drivers are
excluded entirely rather than greyed out, since showing a driver's last
known position after they've clocked out would leak where they went home.
The dispatch radius cap (10 miles) does **not** apply to a passenger's
explicit pick — if they looked at the map and chose someone 12 miles out,
that's a decision to honour, not a bug to correct.

**Known trade-off, not yet revisited**: any signed-in passenger can currently
see every on-duty driver's live position, phone number, and vehicle details
with no matching/booking required first. Confirmed acceptable by the user for
a ~15-driver local operation, but worth flagging if the fleet or user base
grows.

### Post-match cancellation (testing round 2, item #7)
User's original ask was "driver must approve a cancellation," which risks
stranding a passenger if the driver never responds. Landed compromise (user
approved mixing options 1+3): cancellation stays a free, one-tap passenger
action all the way through `DRIVER_ACCEPTED` — at that point the driver has
only spent a tap, nothing more. From `DRIVER_EN_ROUTE` onward (driver is
physically moving) the in-app cancel button disappears and is replaced by a
"call dispatch" card with the number already tappable — a human handles it
rather than a silent button or a hung approval gate. The assigned driver gets
an immediate push notification on any cancellation regardless of stage, and
existing admin trip reports already let cancellations be filtered/counted per
passenger, which is the intended lever against abuse (rather than blocking
cancellation outright).

Both the API (`CUSTOMER_NON_CANCELLABLE` in `routes/trips.ts`) and the
Flutter model (`Trip.canCancel` / `Trip.mustCallToCancel` in
`models/trip.dart`) enforce the exact same status set — these two must be
kept in sync by hand if the rule ever changes again.

### Navigation: why detail screens are nested under /home
`context.go` replaces the navigation stack rather than growing it, so a
screen declared as a sibling of `/home` renders with nothing beneath it and
`AppBar`'s automatic back button never appears — passengers kept getting
stranded on the trip and drivers screens. Two things fix it together, and
both are needed:

1. **Structure** — every passenger screen outside the bottom-nav shell is a
   child route of `/home` (`/home/book`, `/home/drivers`,
   `/home/trip/:tripId`), so home is always underneath.
2. **`AppBackButton`** (`widgets/app_back_button.dart`) as each screen's
   AppBar `leading`. It pops when it can and otherwise navigates to `/home`.
   The fallback matters on the web build: reloading (F5) a deep link starts
   with a genuinely empty stack, which structure alone can't solve.

`test/router_test.dart` reads the real route table via `appRoutes()` and
fails if a screen is added outside `/home`, so this doesn't have to be
re-checked by hand.

### Fare presentation
Booking quotes come from straight-line distance against a rate card, so a
single exact figure reads as a promise and turns any normal re-route or
traffic detour into an argument at the kerb. Quotes are therefore always
shown as a ±10% band (`core/fare_range.dart`, rounded to whole dollars).
A completed trip's `finalFare` is a real charged amount and is shown exactly,
never as a range — the two cases are distinguished by `finalFare != null`.

## Validation Status

- Backend: 101/101 vitest tests passing (real D1/DO via
  `@cloudflare/vitest-pool-workers`), `pnpm run typecheck` clean.
- Mobile: 31/31 Flutter tests passing, `flutter analyze` clean.
- **Not yet deployed or live smoke-tested**: the fare/marker fixes and the
  whole driver app are committed locally but unpushed at the user's request.
  The usual rule still applies — deploy, then verify against production
  before calling any of it done.
- Last verified deploy was commit `73ad5ec`: CI green, live against
  `api.nhtaxi.com` and `gnncab-preview.pages.dev`, `GET /api/drivers`
  returning 200 (empty list, no drivers registered yet) and 401 when
  unauthenticated.

## Unconfirmed Historical Notes

- Phase 9 (Stripe integration) is indefinitely postponed; cash system remains
  the only payment path (`PAYMENT_METHODS = ["cash"]` in the contract
  package — DB CHECK constraint deliberately left wide for a trivial future
  reversal).
- Phase 10 (go-live & cutover from legacy Trackcar system) not started.
