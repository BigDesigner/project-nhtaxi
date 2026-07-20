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
  itself once an admin exists. **It was used during Faz 2 and is now locked** —
  the production admin (`info@nhtaxi.com`) exists and works. Any further admin
  accounts are created by that admin via `POST /api/admin/users`.

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

### Faz 9 — Admin Panel & Driver Photos
- Admin shell (Drivers / Trips / Money / Settings), again built against
  endpoints that already existed.
- Drivers tab leads with the approval queue, because an unverified driver
  cannot go online at all and a sign-up lost in an alphabetical list is
  someone who cannot work. Approving is one tap; withdrawing approval asks
  first, since it takes a working driver off shift.
- Money tab: total outstanding across the fleet, split usage-fee vs
  commission, sorted by who owes most, plus the cash-collection log.
  Recording a payment pre-fills the full outstanding amount and invalidates
  both views, so the same cash can't be recorded twice.
- Trips tab pulls TIMEOUT / DRIVER_NO_RESPONSE rows to the top — the only
  ones the office must act on. Phoned-in bookings are guest-only by design.
- Settings edits both revenue streams, kept visually separate because the
  passenger fare and the driver's debt are different businesses sharing a row.
- **Driver photos**: stored in the *existing* R2 bucket under an `avatars/`
  prefix, unencrypted (unlike the identity documents beside them, which stay
  envelope-encrypted and admin-only), and served through an authenticated
  Worker route rather than a public URL — it's a person's face, and an
  unguessable URL is not access control. The serve route refuses any key
  outside `avatars/`, with a test proving a `photoKey` pointed at a document
  yields 404 rather than leaking it. SVG uploads rejected (script vector).
  Flutter fetches the bytes through the API client, since `NetworkImage`
  can't carry a Bearer token on the web build.

### Faz 10 — Correct pricing, signup agreements, password rotation
Three unrelated things that landed together, each one a gap that mattered.
- **Driving distance became real.** See "Distance is real driving distance"
  below — this was the single most valuable fix in the project so far.
- **Sign-up now requires accepting terms**, with separate passenger and
  driver documents, enforced server-side and recorded per account. See
  "Sign-up requires accepting terms" below.
- **Change password** (`PUT /api/auth/password`). Until this there was no way
  to rotate a credential at all — a leaked password could only be changed by
  editing the database by hand. It asks for the current password even though
  the caller already holds a token (a phone left unlocked must not be enough
  to take an account), revokes every existing session including the calling
  device's (the usual reason to change a password is that somebody else has
  it), and hands back a fresh session so the person doing it isn't signed out
  of the app they're standing in. Reachable from all three roles' settings.
- Fixed a test that had failed twice under full-suite load while passing
  alone: it waited for "the next WebSocket frame" and asserted on its type,
  which is order-dependent with thirty sends in flight. A test that fails
  randomly in CI blocks deploys for no reason and teaches people to re-run
  rather than look.

### Testing Round 3 — 10 items
Mostly questions and two real bugs.
- **Driver sign-up was unreachable.** "Drive with us" looked dead; it was
  navigating correctly and being bounced straight back. The redirect guard
  matched `/signup` by exact equality, so `/signup/driver` counted as a
  protected page for an anonymous visitor. Now a prefix match over the
  pre-login subtree, with a test asserting every route under the auth screens
  is reachable without a session. The existing router test only checked route
  *shape*, which is exactly why this slipped through.
- **Passenger home screen split.** It listed every trip ever taken, pushing
  the useful part off the bottom. Home now shows only what is happening now
  (including a timed-out search, which is technically over but is the thing a
  passenger most wants to restart); everything else moved to a new Trips tab
  grouped into in-progress / completed / cancelled.
- **Driver map no longer disappears** when nobody is on shift. Replacing the
  whole screen with a sentence read as a failure and gave no way to tell "no
  drivers" apart from "the map didn't load".
- Renamed the admin assign-a-job entry, which was called "Phoned-in booking"
  and wasn't recognisable as the way to send a driver to a pickup — the user
  couldn't find a feature that had been built and working.

### Faz 11 wave A — Commission follows referrals, not origin
The business model, stated plainly because the code now depends on it:
**drivers pay rent for time on the app, and ordinary dispatch work is what
that rent buys.** Commission is owed *only* on jobs GNN LLC referred. Taking
a cut of everything would be charging twice for the same thing.

Commission used to key off `origin`, so it only ever landed on admin-panel
assignments. That missed the commonest referral by far: the office rings a
passenger, says "download the app and ask for Dan", and the trip arrives
looking like any other booking. Nobody was charged for those.

`referralSource` now decides, and records who said so — see "Referrals and
commission" below for the full mechanism.

### Faz 11 wave B — Referral jobs opened at the kerb, and the path recorded
The office often phones a driver directly about a passenger who is not in the
app at all. There was no way to record that job, so it either went unbilled or
was reconstructed from memory — and the commission on it rested on that
recollection.

The driver now taps once as the passenger gets in and once as they get out.
Both taps carry the phone's GPS (`POST /api/referral-trips`, then
`/{tripId}/complete`), so pickup and dropoff are captured as they happen and
the fare is computed from the same routed road distance as every other trip.
The trip opens already `TRIP_STARTED` with `origin: DRIVER_REFERRAL` and
`referralSource: DRIVER_DECLARED`, and the commission rate is snapshotted at
the kerb so a mid-trip rate change can't rewrite it.

An earlier idea — a manual "log a past job" form — was rejected for exactly
the reason above: it asks a tired driver to recall a route and name a price.

**Metered fare: decided.** The fare is the routed distance between the real
pickup and the real dropoff. Summing breadcrumbs was rejected — GPS jitter
would inflate every trip, a wandering route would charge more for being
wandering, and the price would end up depending on the quality of a phone's
signal. The reasoning lives in `core/trip_path_recorder.dart` and the
`tripBreadcrumbsTable` schema comment so it isn't re-litigated later.

**Breadcrumbs are evidence, not billing.** Sampled every ~30s while a
passenger is aboard — never before pickup, since where a driver drove before
collecting someone is nobody's business and recording it would collect
location data with no purpose to justify keeping it. Points carry the time the
*device* saw them, so a phone coming back into signal uploads a backlog that
still draws in the order it was driven. A failed upload keeps its points and
retries; only a 400 (path closed) discards them. The office sees the route at
`/home/trip-path/:tripId`.

**The approval gate that was nearly missed.** Every other route to a job runs
through dispatch, which only offers work to approved drivers. This one bypasses
dispatch, so the driver app hiding the button was the *only* thing stopping an
unapproved driver opening billable trips. Now checked server-side. Completion
is deliberately left ungated: if approval is revoked mid-journey the passenger
is still in the car, and refusing to close the job would leave the trip open
with its fare uncomputed.

**Migration 0007 — the table rebuild that failed twice, done properly.**
drizzle-kit's generated version reproduced both prior failure modes plus a new
one (it created `trip_breadcrumbs` against the table it was about to drop).
Hand-written instead: all three children — `trip_events`, `payments` and
`driver_trip_commissions` — are repointed at `__new_trips` *before* the old
table is dropped, so the drop is safe whether or not `PRAGMA foreign_keys=OFF`
survives D1's per-statement HTTP requests. `driver_trip_commissions` was new to
this problem: it was empty during 0002 and holds real charges now.

`apps/api/test/seed-migration-check.sql` closes the gap that made 0002 pass
locally and fail twice remotely — local had trips but no *child* rows, so
`DROP TABLE trips` had no foreign key to violate and "it worked locally" was
measuring nothing. **Seed it before testing any future table rebuild.**

## Known Incomplete Work

- **Phase 7 Wave 3**: WebSocket live driver-position updates in the app.
  LocationHub exists server-side; the Flutter client doesn't consume it yet,
  so the driver map is a static snapshot refreshed by pull/tap. Overlaps with
  breadcrumbs above — worth doing together.
- **Push notifications deliver nothing, and the missing piece is bigger than
  it was recorded as.** This was previously noted as "waiting for the Firebase
  service-account key", which understated it: the app had no push client at
  all, so no device had ever registered a token and supplying the key alone
  would still have delivered nothing. Everything that isn't Firebase now
  exists (`core/push_tokens.dart` — register on sign-in and cold start,
  unregister *before* logout tears down the session). Three steps remain, all
  user-owned:
  1. Create the Firebase project and run `flutterfire configure`.
  2. Add `firebase_core`/`firebase_messaging` and replace
     `deviceTokenSourceProvider` with one returning
     `FirebaseMessaging.instance.getToken()`.
  3. Set the `FCM_SERVICE_ACCOUNT_KEY` Worker secret.
  The plugin is deliberately *not* added yet: without `google-services.json`
  it fails the Android build in CI.
- **Custom domain** `gnncab.nhtaxi.com` → `gnncab-preview.pages.dev` needs to
  be attached in the Cloudflare dashboard (user-owned step; CORS is already
  configured for it).
- **Public OSRM instance** is what prices every trip today. It is a demo
  service, not a production one, and can rate-limit us — at which point
  quoting fails closed (503) rather than returning a wrong price. Move
  `ROUTING_BASE_URL` to a self-hosted or paid OSRM-compatible endpoint before
  real volume. Config only, no code change.

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

### Distance is real driving distance — never a straight line
**This is the single most load-bearing number in the system.** The final fare
falls back to the estimate (`finalFareCents = estimatedFareCents`), so any
error in the distance is charged to GNN LLC on every mile of every trip.

`lib/routing.ts` asks an OSRM-compatible routing engine what the car will
actually drive. Two rules it must keep:

1. **No fallback to an approximation.** An earlier version multiplied
   haversine (crow-flies) distance by 1.3. That is wrong by a different
   amount on every route — a winding valley road and a highway run do not
   share a factor — and it silently under- or over-charged. If routing is
   unavailable the API returns 503 (`RoutingUnavailable`, handled centrally
   in `app.ts`) and refuses to quote. A booking that can't be priced is an
   inconvenience; a booking priced wrongly is a loss.
2. **OSRM takes `lng,lat`**, the reverse of everything else in this codebase
   and every map UI. Reversed, it still returns a confident distance — for a
   completely different journey. There is a test pinning the order.

Results are cached a month by rounded coordinates (taxi work repeats the same
airport runs constantly). `ROUTING_BASE_URL` in `wrangler.toml` points at the
public OSRM instance; **swap it for a self-hosted or paid endpoint before real
volume** — the public one is a demo service and can rate-limit us, at which
point quoting fails closed.

`haversineMiles` survives in `lib/fare.ts` only for ranking nearby drivers
during dispatch, where "roughly who is closest" is fine and no money depends
on it.

The test suite stubs global `fetch` (`test/stub-routing.ts`) so it never
reaches the real router: it would be slow, flaky, non-deterministic, and rude
to a free community server.

### Sign-up requires accepting terms, and records which ones
Passengers and drivers accept **different documents** (`lib/legal/terms.dart`)
— a driver's RSA 376-A eligibility, document encryption and what they owe GNN
LLC have no bearing on a passenger, and one combined document means neither
party reads their part.

Enforcement is server-side: both registration schemas require the acceptance
flag as `z.literal(true)`, so sending `false` fails outright rather than
quietly recording a "no". The account row stores `termsAcceptedAt` *and*
`termsVersion` — "they agreed" is worth little in a dispute without being
able to say what they agreed to. `CURRENT_TERMS_VERSION` in the contract
package and `termsVersion` in the Flutter file must be changed together.

The UI puts the text behind a tap and only enables "I accept" once it has
been scrolled through; the checkbox cannot be ticked without opening the
document.

**The privacy sections state what the software actually does and deliberately
do not claim data never leaves GNN LLC** — that would be false. Addresses go
to OpenStreetMap for lookup and device tokens to Firebase for notifications.
Overclaiming would be worse than saying nothing. If a third-party service is
ever added, these documents need updating.

### Referrals and commission
**The rule: drivers pay rent for time on the app; ordinary dispatch work is
what that rent buys. Commission is owed only on jobs GNN LLC referred.** This
is not a platform taking a cut of everything, and code that assumes otherwise
is wrong.

`trips.referralSource` decides — never `origin`, which cannot express it. A
referral reaches a driver by three different routes that all look like
different origins:

| How it happened | What sets the flag |
|---|---|
| Office picked the driver in the admin panel | `ADMIN_ASSIGNED`, set at creation |
| Office phoned the passenger ("ask for Dan") — arrives as an ordinary booking | `DRIVER_DECLARED`, driver ticks the box |
| Office set it afterwards | `ADMIN_MARKED` |

Two rules hold the money together:

1. **The driver's tick is one-way.** `gnnReferred: true` can turn a referral
   on; it can never clear one the office set. Otherwise a driver could opt out
   of commission on exactly the jobs that owe it and nobody would notice. The
   rate is snapshotted at that moment so a later change to the global
   percentage can't rewrite what they agreed to before accepting.
2. **The office has the last word.** Nobody volunteers to pay commission, so
   a system resting only on the driver's tick would quietly lose money on
   every job they forgot. `PUT /api/admin/trips/{id}/referral` sets or clears
   it on any *live* trip, audit-logged. Refused once completed: the commission
   row is written by then, and silently re-deriving money after the fact is
   worse than making someone adjust the balance deliberately.

`routes/referral-commission.test.ts` pins all of this, including the
one-way rule, the rate snapshot and the admin-only permission.

### Fare presentation
Booking quotes come from straight-line distance against a rate card, so a
single exact figure reads as a promise and turns any normal re-route or
traffic detour into an argument at the kerb. Quotes are therefore always
shown as a ±10% band (`core/fare_range.dart`, rounded to whole dollars).
A completed trip's `finalFare` is a real charged amount and is shown exactly,
never as a range — the two cases are distinguished by `finalFare != null`.

### Auth is protected-by-default on driver routes
`routes/driver_profile.ts` used to apply `authenticate + requireRole` route
by route (`use("/profile", …)`, `use("/earnings", …)`, …). That meant **every
new endpoint shipped public** until someone remembered to add a line — and
the photo upload did exactly that. It only surfaced because the handler
crashed on a missing `user`; a handler that didn't dereference it would have
worked fine, for anyone on the internet.

The router now guards `*` via `except("/api/driver/register", …)`, so a new
route is private unless deliberately exempted, and
`routes/driver-auth.test.ts` walks every driver endpoint asserting an
anonymous caller gets 401. **Add a row there when adding an endpoint.** The
same pattern is worth applying to the other routers if they're ever touched.

## Validation Status

As of commit `d60f442` (Faz 11 wave B), everything below is deployed and
verified against production.

- Backend: 157/157 vitest tests passing (real D1/DO via
  `@cloudflare/vitest-pool-workers`), `pnpm run typecheck` clean.
- Mobile: 56/56 Flutter tests passing, `flutter analyze` clean.
- CI `Deploy` + `Mobile` workflows green; live on `api.nhtaxi.com` and
  `gnncab-preview.pages.dev`.
- Migrations `0004`–`0006` were single `ALTER TABLE … ADD COLUMN` statements,
  deliberately, since the two migrations that ever failed remotely were table
  rebuilds. **`0007` is a table rebuild and applied cleanly to remote D1** —
  the first one to do so. It was proven locally first against a database
  seeded with rows in all three child tables (see wave B above).
- Live smoke tests run against production, not just CI:
  - **Driving distance is right.** North Conway → Boston Logan quotes
    136.27 mi (real drive ~135–140); → Portland ME quotes 65.04 mi (real
    ~62). For contrast, the straight-line-only version quoted 117 mi and the
    straight-line×1.3 version quoted 151.8 — under- and over-charging
    respectively, which is why no single factor was ever going to work.
  - Registration without accepting terms → 400.
  - Every `/api/driver/*` endpoint → 401 when anonymous.
  - Change password: wrong current password → 401; correct → 200 with a new
    session; the old refresh token → 401.
  - Referral trips (wave B): all three new paths present in the live OpenAPI
    doc; an unapproved driver → 403; unknown trip → 404; malformed
    coordinates or an empty breadcrumb batch → 400.
  - **Not yet proven live: the referral happy path.** It needs an *approved*
    driver, and approval runs through the admin panel, so it wants either the
    admin signing in and approving a test driver or one of the existing
    approved drivers running the flow on a phone. Everything up to the
    approval gate is verified end to end against production.

### Test accounts in production
The drivers visible in the admin panel are from live smoke tests, not real
people. They can be deleted. The admin account is `info@nhtaxi.com`
(bootstrap, now locked); its password was rotated by the user via the new
change-password flow.

## Unconfirmed Historical Notes

- Phase 9 (Stripe integration) is indefinitely postponed; cash system remains
  the only payment path (`PAYMENT_METHODS = ["cash"]` in the contract
  package — DB CHECK constraint deliberately left wide for a trivial future
  reversal).
- Phase 10 (go-live & cutover from legacy Trackcar system) not started.
