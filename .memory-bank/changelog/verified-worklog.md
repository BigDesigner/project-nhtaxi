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

### Faz 7 Wave 3 — WebSocket live tracking, and the bug it uncovered
LocationHub has broadcast a driver's position to their matched passenger and
to every connected admin since Faz 4. Nobody ever consumed it — and while
investigating that, found something worse: **nobody ever sent one either.**
`driver_profiles.currentLat/currentLng` is written *only* by a
`LOCATION_UPDATE` frame arriving over this socket, and no client-side code
existed to send that frame. Nearest-driver dispatch (`lib/dispatch.ts`) and
the passenger's "choose a driver" map both silently skip a driver whose
position is null. In production, that meant every real driver who hadn't
been hand-seeded by a test — i.e. all of them — was invisible to both, the
whole time. This was not a missing nicety; it was dispatch quietly not
working for anyone who wasn't a test fixture.

Fixed with `core/driver_location_broadcaster.dart`: starts the moment a
driver goes online (and on a cold relaunch mid-shift), samples position every
10 seconds, sends it over a new shared `core/location_socket.dart`
(reconnects on drop, torn down on logout). Deliberately separate from the
trip-breadcrumb recorder (wave B) rather than merged into one GPS loop — one
is an ephemeral live position feeding dispatch, the other a permanent
evidentiary trail that only exists once a passenger is actually in the car;
merging them would have meant recording a driver's pre-pickup movement as
part of a trip's permanent record, which wave B explicitly ruled out.

Consumers: the passenger's active-trip screen gets a small live map once a
driver is matched (`core/live_driver_position.dart`'s single-driver stream —
the hub never sends more than that to a passenger); the admin panel gets a
new "Live map" tab showing the whole fleet (the hub already sent admins
everything; this just puts it on screen). The passenger's *browsing* map
(choose-a-driver, pre-trip) deliberately stays snapshot + pull-to-refresh —
the hub has no authorized relationship to hang a live broadcast on until
there's an actual trip, and broadcasting every driver's position to anyone
browsing would be both wasteful and a real position leak. Trip-status
polling is unchanged; only the driver's position moved off it, onto the
socket.

15 new Flutter tests, all against a fake in-memory transport — no real
sockets touched in CI: message decoding, reconnect-after-drop, disconnect
stops reconnecting, the broadcaster's immediate-first-tick and idempotent
start/stop, and the position providers' filtering (one driver vs. the whole
fleet). Zero backend changes — LocationHub was already correct; only the
client side was missing.

### Brevo transactional email — signup, password change, trip completion
`lib/email.ts` calls Brevo's HTTP API directly with `fetch()`, no SDK — same
reasoning as the FCM push integration: their client libraries assume Node,
this Worker doesn't have it, and the surface actually needed is one endpoint.
`BREVO_API_KEY` follows the exact rollout pattern as
`FCM_SERVICE_ACCOUNT_KEY`: empty/unset means "not configured yet", every send
silently no-ops, and the feature ships ahead of the secret existing. **The
secret is not yet set in production** — the user sets it themselves via
`wrangler secret put BREVO_API_KEY` (never typed into chat; see
`.specs/bootstrap.md`), and nothing above needs touching once they do.

Four best-effort call sites, all fired via `c.executionCtx.waitUntil(...)`
alongside the existing push/audit calls on the same transitions:
- Passenger and driver registration → a welcome email to the new account,
  plus a notice to every active admin (`getAdminEmails` — queries
  `users` for `role='admin' AND isActive`, so this already works whether
  GNN LLC ever has one admin or several). For a driver this is the notice
  that starts the office's document-review clock.
- Password changed → a security notice to the account, alongside the
  existing "every session revoked" behaviour on that same route.
- Trip completed → a summary to the passenger (skipped for a guest/referral
  trip — no registered account means no inbox to reach) and a fuller copy to
  the office naming the driver and the fare. Wired into **both** completion
  paths: the ordinary status transition (`routes/trips.ts`) and the
  referral-trip endpoint from wave B (`routes/referral_trips.ts`) — a
  referral trip never has a `customerId`, so only the office copy fires
  there, which is exactly the record a job with no passenger account behind
  it most needs.

`test/stub-routing.ts` — already the guard that stops the suite reaching the
real routing service — now does the same for Brevo, capturing what would
have been sent (`capturedEmails()`) so tests assert on the real payload
without ever sending mail. 9 new tests: `sendEmail`'s no-op paths and a
successful-send payload shape, `getAdminEmails` filtering out drivers/
passengers/deactivated admins, and `sendTripCompletedEmails` covering a
registered passenger, a guest/referral trip, and the no-admins case.

**Not yet detailed, on purpose:** templates are plain HTML with no branding —
content and layout were explicitly left for later. A "reports by email"
category the user mentioned has no natural trigger event yet (unlike
registration/password-change/trip-completion, which are all real moments)
and needs its own design pass before it's built.

### Trip path verification — anchored on the booking, not the passenger
The user's idea was to cross-check a driver's and passenger's GPS against each
other to catch a shrunk fare. That doesn't actually work: the trips where a
driver's declared distance most needs checking (referral jobs) have no
passenger account to compare against, and on an ordinary dispatched trip the
passenger typed the pickup/dropoff themselves — comparing their own phone to
their own typed address proves very little. **Decided instead:** anchor on
the trip's own recorded pickup/dropoff and compare the driver's breadcrumb
trail against *that*. One check, identical for every trip type, needs
nothing new from the passenger.

`lib/path-verification.ts` — at completion, takes the earliest breadcrumb
(by recorded time, not insertion order — a phone catching up on a backlog
must not scramble which point is "first") against pickup, the latest against
dropoff, worst of the two decides. `PATH_TOLERANCE_MILES = 0.5` per the
user's own number. No breadcrumbs at all (dead phone, or a trip that predates
this) → `NOT_CHECKED`, never a false `MISMATCHED` — silence is unknown, not
guilt. Wired into both completion paths (ordinary status transition and the
referral-trip endpoint), awaited synchronously since it's pure DB work with
no network call, unlike the push/email side effects on the same transition.

New columns `trips.path_verification` / `trips.path_deviation_miles`
(migration `0008`, applied cleanly) — plain `ADD COLUMN`, no SQL `CHECK`,
same call already made for `paymentMethod` on this table: skipping the
constraint on a column only this codebase ever writes keeps the migration in
the safe category instead of the table-rebuild category.

**Driver/admin only, by construction, not by convention.** The result is
deliberately absent from `TripResponseSchema` — every existing call site that
returns a trip, including the passenger's own, is untouched — and exposed
solely through `GET /api/trips/{tripId}/path-verification`, gated to the
assigned driver or an admin. Putting the gate on one dedicated endpoint
means there is exactly one place to get this right, instead of a field that
has to be remembered and stripped at every trip-returning route.

Surfaced with a small badge (quiet green for matched, amber for mismatched,
nothing at all for not-checked) on the two screens where it's relevant: the
admin's existing trip-route map (wave B) and a driver's own completed job.
14 new backend tests (8 unit — including the out-of-order-backlog case — plus
6 for the access gate itself: admin yes, owning driver yes, another driver
no, the booking passenger no, unknown trip 404) and 3 Flutter model tests.

### Service areas, and the owner-operator dual role
Answered a direct question honestly rather than building something to match
a guess: **service areas do nothing today.** No dispatch or booking code
anywhere reads a city's bounds — `cities` is a name+timezone label with no
radius, and the `zones` table that could hold a real polygon geofence is
defined but never read anywhere. Left unenforced on purpose, not just
unfinished: `admin_settings_tab.dart`'s own passenger-facing copy already
promises coverage across New England and long-distance runs into New York
and Pennsylvania, so a hard boundary would reject exactly the bookings this
business wants. Fixed the two real bugs instead — duplicate detection
(name+state, case-insensitive) and a working delete, with a 409 rather than
a raw FK error if something still references the area.

While in `routes/admin.ts`, closed the two paths that could mint a second
admin: `POST /users` and `PUT /users/{id}` now refuse `role: "admin"`
outright, 403. Nothing reachable through the API grants it any more — the
bootstrap endpoint (already capped at one account) is the only path left,
and a future second admin is a direct database change.

That same "no API path grants it" reasoning is what the owner-operator dual
role rests on: the same person runs the office and also drives. Rather than
teaching every driver-only check in this codebase about a new combined role
value, `users.isAdmin` is orthogonal to `role` — the account keeps
`role: "driver"` (so dispatch, the driver app, `assertOwnsTrip`, LocationHub
all treat it as an ordinary driver with zero special-casing) while
`isAdmin: true` unlocks the admin panel through `requireAdmin()`, the one new
gate that replaced `requireRole("admin")` on the admin router. No endpoint
sets `isAdmin` either — direct database access, once, for the one account
this is for.

In the app, which shell is on screen is a pure UI toggle
(`viewModeProvider`), not a security boundary — both surfaces stay reachable
to that account regardless. Defaults to the driver screens on login (per the
office's own description of the desired flow), with a cross-over tile in
each side's settings, and resets to driver on logout so a later session on
the same device can't inherit the wrong shell.

Migration `0009` adds `users.is_admin` as a plain `ADD COLUMN`, no `CHECK` —
same reasoning as `path_verification` before it: a column only this codebase
ever writes doesn't need the SQL-level enum enforcement, and skipping it
keeps the migration in the cheap, safe category.

**Not yet done: actually flipping the production admin account.** Everything
above is inert until an account has `role: "driver"` + `isAdmin: true` — the
current production admin (`info@nhtaxi.com`) is untouched, still
`role: "admin"`, `isAdmin: false`. Converting it is the one step held back
for the user to confirm before it happens to the account that runs the
business, per this session's own "ask before an irreversible-ish production
change" rule — see the wrap-up message for that ask.

Added a Tawk.to live-chat button to the passenger app as a separate, smaller
piece: a chat-bubble FAB on the passenger shell opens the direct chat link
in a WebView (native) or a browser tab (the Flutter web preview build, which
`webview_flutter` doesn't support at all) — never the `<script>` embed Tawk.to
hands out, which assumes an HTML host page a native screen doesn't have.

10 new backend tests, 5 new Flutter model tests, live-verified: the new
`DELETE /cities/{cityId}` route is in the live OpenAPI doc, and the admin
auth gate still 401s an unauthenticated request. **Not yet proven live: the
admin-lockdown and dual-role gates themselves**, which need real admin
credentials this session doesn't have — worth a quick manual check once the
account conversion above happens.

### Driver ratings & reviews
Passengers rate a completed trip on five 1–5 star questions — courtesy, safe
driving, on-time pickup, kept-you-informed, clean vehicle — plus an optional
comment. Five separate questions, not one score, so a driver gets something
they can act on. The rating folds into their headline average
(`driver_profiles.rating`, **which was dead until now — see the dead-list
below**) and drives the review summary a passenger sees when tapping a driver.

Only a registered passenger's own TRIP_COMPLETED trip can be rated, once (the
`trip_ratings.trip_id` is unique — a rating is a record of how the ride felt
at the time, not something to rewrite later). A guest/referral trip has no
customer account, so it's never rated. The insert and the recomputed driver
average land in one `db.batch()` — a rating that counted but didn't move the
average would leave the headline wrong.

New table `trip_ratings` + a new `driver_profiles.rating_count` column
(migration `0010`, a plain CREATE TABLE + ADD COLUMN, no rebuild). New routes:
`POST/GET /api/trips/{id}/rating`, `GET /api/drivers/{id}/reviews` (aggregate
+ per-question averages + recent commented reviews, **no reviewer identity** —
the score is public, who said it is not). The directory response now carries
`rating`+`ratingCount` so the passenger's map/list shows stars. App: a rating
prompt on the completed-trip screen (or a read-only recap once rated), star
chips + a reviews section on the driver sheet, and the driver's own average on
their profile tab. 9 backend tests, 6 Flutter model tests.

### Driver marker: a top-view car that turns to its heading
The map used to show drivers as a generic pin. Now each driver is a top-view
taxi PNG (`assets/markers/car.png`, nose-up) that rotates to the direction of
travel, with a small status pip in the corner (green available / red busy /
amber reserved) rather than colouring the car body. Heading is derived
**client-side** from consecutive live positions (`core/live_driver_position.dart`),
with a 15-metre movement threshold so a parked car holds its heading instead of
spinning on GPS jitter; a driver with only one known position (just connected)
points up rather than guessing. Zero backend change — it reads the same
LocationHub position stream wave 3 added. The user supplied the PNG after a
hand-drawn SVG was rejected ("looks like a space shuttle"); the marker uses
`Image.asset` (raster) not an icon font, so the web release build can't subset
its glyphs away.

### Each side sees who they rode with, in their history
Trip history showed the other party's name only to the admin. Now a passenger
sees the driver's name on their trips and a driver sees the passenger's name on
their past jobs. `TripResponse` gained `driverName`/`customerName`, filled from
a self-join on `users` (joined twice via drizzle `alias()` — once for the
driver's profile, once for the customer), populated on the trip list and detail
responses and null on the live create/status responses that don't need them.
`customerName` falls back to the guest name for an account-less booking.

### Money reporting — everything financial as CSV and PDF
Every figure the business runs on can now leave the app as a formatted file,
for accounting and tax filing.

**Backend** added two read-only aggregation endpoints (no schema change — it all
sums from tables that already exist): `GET /api/admin/reports/financial-summary`
(period totals: usage fee + commission = GNN income, cash collected, and — kept
deliberately separate — the drivers' gross fares, which are their turnover, not
GNN's) and `GET /api/admin/reports/driver-earnings` (completed-fare total per
driver, whole fleet or one via `?driverId`). CSV output (`?format=csv`) added to
the balances and commissions reports too, so all four money reports have a raw
API export. See ADR 0007 for why the *designed* exports are built client-side.

**Flutter** builds both the CSV and the PDF from one `ReportTable` model
(`core/report_export.dart`, `core/report_tables.dart`), so the two formats carry
an identical, self-describing layout: an org/title/period header, column
headers, a bold TOTAL row, and a legend explaining every column and the money
model. PDF via the `pdf`/`printing` packages (browser download on web, share
sheet on mobile); CSV via `share_plus`, OWASP formula-injection-guarded and
UTF-8-BOM'd so Excel reads Turkish names. The admin Money tab gained an
"Export" card with a date-range picker and a button per report; drivers can
export their own earnings from their earnings tab (their own tax record). The
GNN LLC letterhead (address, tax number, logo) is a filled-in-later seam in
`ReportOrg` — the user will supply it.

Two follow-up fixes the same feature needed: the PDF's built-in Helvetica has no
Unicode, so Turkish names and em-dashes printed as empty boxes — fixed by
embedding **Roboto** via `PdfGoogleFonts` (fetched once, cached; a report's data
is already fetched over the network so an export always has connectivity, and it
falls back to the built-in font rather than failing) — and all report *text* was
switched to plain ASCII punctuation (`:` `;` `->` `...`) so it stays clean
regardless of which font the PDF ends up using.

### Short trip IDs, admin lookup, and richer report rows
A trip's id is a UUID; nobody can read one out or match one by eye. Now the
first 8 characters are the human-facing code everywhere — on the passenger,
driver and admin trip detail, each with a **Copy Trip ID** button that puts the
*full* id on the clipboard, and in every report row. This powers a simple
support flow: "read us your trip ID". A new admin **"Find a trip by ID"** card
(`GET /api/admin/trips/lookup?q=`) prefix-matches the code and shows the full
trip; the query is sanitised to the id charset (hex + hyphen) before it reaches
`LIKE`, which also neutralises `%`/`_` wildcards. First-8 is not guaranteed
unique, so the lookup returns *every* prefix hit rather than guessing — a
collision across a small fleet is astronomically unlikely but never silently
mis-resolves.

Report trip rows stopped being bare UUIDs: the driver's own earnings and a new
admin **Trip & fare report** (added to the export card) show the passenger name
and the route (pickup `->` drop-off) alongside the short id. Backend added the
addresses to `/reports/trips`, the customer name + addresses to
`/driver/earnings`, and the lookup endpoint.

### Trip & fare report: stop mixing cancelled trips into the total
Commission is only ever charged at the `TRIP_COMPLETED` transition
(`routes/trips.ts`), but the trip & fare report summed every row's fare into
TOTAL regardless of status and marked a referred-but-cancelled trip "Y" as if
it had actually carried a cut — neither was true, and the two together read as
completed and cancelled money tangled together. Every trip in the period is
still listed (a new Status column makes that explicit), but only
`TRIP_COMPLETED` rows now feed the Fare total and the Referred flag; a note
calls out how many trips were excluded and their combined quoted amount.

### Rebrand to NH Taxi
"GNNcab" was this rebuild's working name, never the business's real brand —
the operator's actual domain and identity is `nhtaxi.com`. Renamed in two
layers, decided together after confirming the app has no app-store listing yet
(the one and only free window to change an Android `applicationId`/Flutter
package name — free before publishing, a new listing from zero afterward):
every user-visible string (UI, legal terms — `CURRENT_TERMS_VERSION`/
`termsVersion` bumped alongside the wording, OS-level labels, transactional
emails, the OpenAPI title) → "NH Taxi"; and the app's technical identity
(Android `applicationId`/namespace `com.gnncab.gnncab` → `com.nhtaxi.app`,
Flutter/Dart package `gnncab` → `nhtaxi`). "GNN LLC" is untouched — that's the
legal entity, not the product name. **Deliberately not renamed**, by explicit
user instruction, purely cosmetic: the repo folder, the Cloudflare Worker/D1/R2
resource names, and the Flutter web preview subdomain `gnncab.nhtaxi.com`
(slated to become `app.nhtaxi.com` once the legacy Trackcar app, which reserves
`app.`, is retired — a separate future task). See ADR 0009 for the full
reasoning and exact scope boundary.

### Real branding assets: app icon, splash, in-app logo, PDF logo
The user supplied the actual NH Taxi artwork (a taxi-and-moose-head mark, "NH
TAXI · LIVE FREE · RIDE LOCAL") as five PNGs — square icon (opaque, 1024×1024:
iOS rejects a transparent app icon), splash mark (transparent, same size —
splash screens compose as a solid background colour filling the whole screen
plus a small centred image, never a full-screen picture, so square is correct
and 9:16 would have been wrong), a horizontal wordmark for in-app display, a
matching one for the PDF letterhead, and a spare square variant not wired
anywhere yet. Dropped at `apps/mobile/assets/branding/`.

`flutter_launcher_icons` and `flutter_native_splash` (new dev dependencies)
generate every Android density + the web favicon/manifest icons from the one
square source — `dart run flutter_launcher_icons` / `flutter_native_splash:
create` regenerate them if the art changes. iOS is configured but skipped
(`ios/` doesn't exist yet, see ADR 0006); flip `ios: true` in `pubspec.yaml`'s
`flutter_launcher_icons:` block once `flutter create --platforms=ios .` runs,
then re-run both generators.

The horizontal wordmark replaces the plain "NH Taxi" text on the login screen
and the passenger/driver home tab's app bar (`widgets/brand_logo.dart`, a
thin `Image.asset` wrapper) — the driver one keeps a "Driver" text suffix
next to it since the mark alone doesn't say which app this is. The PDF
report header (`core/report_export.dart`) now actually renders `ReportOrg.logo`
as an image (that rendering path didn't exist before, only the data field
did) — defaulting to the same wordmark loaded once from
`assets/branding/logo-pdf.png` and cached, with the same "network access
already required, so the asset load always succeeds; if it somehow doesn't,
render without a logo rather than fail the export" pattern used for the
Roboto font. **`ReportOrg.gnn`'s name stayed "GNN LLC"** — a formal financial
export names the legal filer, not the consumer brand, even though the logo
above it is the consumer mark. A `testWidgets` test (not a bare `test()`)
asserts the asset path actually resolves via `rootBundle.load`, since the
try/catch fallback means a typo'd path would otherwise degrade silently to
"no logo" instead of failing anything. 104/104 Flutter tests, verified
visually in a local `flutter build web` (splash renders correctly on white,
browser tab title reads "NH Taxi", the login screen's logo shows undistorted).

### Theme colour: the taxi-yellow from the logo, not green
The whole app's buttons/accents came from one Material 3 seed colour
(`ColorScheme.fromSeed`) that was still the pre-rebrand dark green — every
`FilledButton`, the nav bar's selection indicator, all of it. Sampled the
actual taxi-yellow out of the logo artwork itself (`logo-horizontal.png`'s
dominant pixel colour, `#FCC803`) rather than guessing a generic amber, and
made that the seed. `primary`/`onPrimary` are then forced explicitly (amber /
black) via `.copyWith(...)` rather than left to `fromSeed`'s own algorithm —
`fromSeed` optimises for contrast and would otherwise have muted a bright
yellow into a dark gold for button backgrounds, which reads as "brownish", not
"amber". Black text on amber matches how the logo itself pairs them. Every
other semantic status colour (green = available/approved/completed, red =
busy/cancelled, amber pip = reserved, blue = searching) is a separate,
deliberate `Colors.green`/`Colors.red` used directly in each screen and was
left untouched — those mean something specific and aren't the brand colour.

**Follow-up, same day: amber text on white is a real contrast failure.**
`TextButton`/`OutlinedButton` default their *text* to `colorScheme.primary`
too — fine as a button background, a genuine readability problem as text on
a plain white surface (every "Sign up", "Drive with us", "Turn it down",
"Read the terms" link came out amber-on-white, close to unreadable on a
bright screen). Fixed at the theme level rather than per screen:
`textButtonTheme`/`outlinedButtonTheme` now force black, bold text (and a
neutral `Colors.black54` border for the outlined variant) — every call site
in the app inherits this automatically, nothing to hunt down screen by
screen. Checked the handful of places that read `colorScheme.primary`
directly (`_ActionCard`'s icon-in-a-tinted-circle, `trip_timeline`'s rail
dot, the map polyline, the "my driver" car-marker pip, the driver photo's
edit-button circle) — none of them tint actual paragraph text, they're
icons/fills/decorative dots, so none needed the same fix.

**Second follow-up, same day: some of those "just an icon" spots were the
same amber-on-amber problem, and some real actions still looked like plain
links.** Two more rounds of user testing found what the review above missed:

1. Several genuinely important actions — "Sign out" (×4: passenger, driver,
   admin), "Export my earnings", and the whole admin Money "Export reports"
   row (Financial summary / Driver earnings / Trip & fare report / Balances /
   Commissions / Collections) — were `OutlinedButton`/`FilledButton.tonalIcon`,
   which read as secondary/washed-out next to the confidently-amber `Sign in`
   button. All converted to plain `FilledButton`(`.icon`) for one consistent
   "this is a button" look across the app.
2. A few icon badges (`admin_trips_tab.dart`'s "Assign a job" phone icon,
   `_ActionCard`'s leading icon, `DriverAvatar`'s no-photo fallback) used a
   *pale 15%-alpha tint* of the accent colour as the circle background with a
   *full-strength* icon of the **same** colour on top — amber-on-pale-amber,
   nearly invisible, worse on a bright screen. Fixed by making the circle the
   **solid** accent colour and picking the icon/initial colour for contrast
   against it (`ThemeData.estimateBrightnessForColor` — black on the brand
   amber, white on the one non-amber caller, `_BrowseDriversCard`'s teal)
   rather than hardcoding black, since these two widgets take an arbitrary
   caller-supplied colour. The `admin_drivers_tab.dart` "online" badge (green)
   uses the same light-tint idiom but is a semantic status colour, not the
   brand accent, and was deliberately left alone — same reasoning as the
   Colors.green/red status colours noted above.

### Removed the "Service areas" admin screen — inert clutter, not a feature
Asked directly what adding a "service area" actually determines, and traced
it end to end: nothing. `cities` is a name+timezone label (an optional
lat/lng exists on the schema but isn't even exposed in the admin dialog);
`trips.cityId` is defined but no code path ever assigns it (always null);
`fare.ts` always reads the single global pricing row
(`WHERE city_id IS NULL`), never a per-city one; the passenger-facing "Where
we drive" coverage text is a hardcoded static paragraph, entirely
independent of whatever cities exist. Adding or removing one changes
nothing a passenger or driver ever sees or is allowed to do.

Once confirmed, removed the "Service areas" entry point and its `_CitiesDialog`
from the admin Settings tab (`admin_settings_tab.dart`) — pure UI clutter for
a feature that does nothing. **Deliberately kept**: the backend
(`/api/admin/cities`, the `cities` table) and the Flutter providers
(`citiesProvider`/`createCity`/`deleteCity` in `admin_controllers.dart`),
commented to explain why they're unused from the UI — this is the reusable
part if service areas are ever wired to a real geofence/dispatch-radius
feature, and rebuilding a small admin dialog at that point is cheap. No
migration, no backend behaviour change; 104/104 Flutter tests still pass.

### Production launch reset — wiped every smoke-test row, kept the admin
User's explicit instruction: keep `info@nhtaxi.com` (the admin account) and
scrub everything else from the live database, so the app can stand as a
blank slate for real customers instead of carrying this session's months of
smoke-test accounts/trips/documents forward.

Couldn't run this from a terminal here — the local `wrangler` OAuth session
(`bigdesigner@gmail.com`) is authenticated against a *different* Cloudflare
account (`c3bd4d79...`) than the one that actually owns this Worker/D1
(`a7a3a64d...`, per `wrangler.toml`'s `database_id`); `wrangler secret list`
and `wrangler d1 list` both failed with an auth error confirming this. Built
`.github/workflows/db-reset.yml` instead — `workflow_dispatch`-only, requires
typing `RESET` into the trigger input, reuses the same `CLOUDFLARE_API_TOKEN`
already trusted for deploys — and `apps/api/scripts/reset-to-launch.sql`,
which deletes children before the parents they reference (ratings →
commissions → collections → sessions → documents → payments → breadcrumbs →
events → trips → audit_logs, then `driver_profiles`/`customer_profiles`,
then `users` except the admin's email) so it's correct regardless of
whether FK enforcement is on. `push_tokens`/`refresh_tokens` are scoped to
exclude the admin's own rows, so wiping everyone else's sessions doesn't
also force-logout the admin.

Dry-run verified against local D1 first with seeded smoke data (admin +
one customer + one driver + their tokens): after running, `users=1`,
every other table `=0`, admin's own refresh/push token rows untouched.
Then hit the exact same bug the earlier Actions-storage cleanup caused in
`deploy.yml` — the pre-reset backup upload failed on the same stale quota
counter, killing the job before the reset ran at all (safely — nothing was
touched). Fixed with the same `continue-on-error` pattern, and deliberately
did **not** add a job-log fallback for the backup (it contains password
hashes and PII; this repo is headed public, and a public log is the wrong
place for that regardless of the artifact quota). D1's own built-in Time
Travel remains the actual safety net either way.

**Executed live** (GitHub run `30209214498`): verified afterward directly
against production — `users: 1, remaining_email: "info@nhtaxi.com",
trips: 0, drivers: 0, customers: 0, audit_logs: 0`. Production is now a
blank slate.

**Deliberately not touched**: `cities` and `pricing_config` — these are
real business configuration (the base fare/per-mile rates, whatever
service-area rows exist), not smoke-test activity, so they weren't in
scope for a data wipe. **Follow-up not done**: the actual uploaded files in
the `gnncab-driver-documents` R2 bucket, from the now-deleted
`driver_documents` rows, are still sitting in R2 — `wrangler r2 object` has
no bulk list/delete, only one-at-a-time `get`/`put`/`delete`, so cleaning
that up needs a small separate script if the user wants it gone too.

### Closed the one backend/frontend gap the audit found
User's call after the audit below: fix it now rather than leave it noted.
Added `models/customer_profile.dart` + a `customerProfileProvider`
(`FutureProvider`, same idiom as `citiesProvider`) calling the
already-existing `GET /api/customer/profile`, and a "Trips taken" row on the
passenger Profile tab (`passenger_shell.dart`) — same pattern the driver
side already had ("Verified driver · N trips"), just never built on this
side. No backend change needed, the endpoint already returned everything
required. Fails soft: the row simply doesn't render if the fetch is slow or
errors, same treatment as the optional phone row next to it.
`flutter analyze` clean, 104/104 tests pass.

### Full status audit: CI, dangling work, backend/frontend gaps
User asked directly: is the workflow fully sorted, is anything half-done, is
anything built server-side but never wired into the app, is anything mid-
flight. Answered from measurement, not memory:

- **CI**: every run since the deploy-resilience fix above is green.
- **Backend/frontend gap, one found**: cross-checked every path in the live
  OpenAPI spec (55 endpoints) against every API call site in `apps/mobile`.
  54 are wired. `GET /api/customer/profile` (returns `totalTrips` and
  `preferredPaymentMethod`) is never called — the passenger Profile tab
  only reads `/api/auth/me`, which doesn't carry those fields. The driver
  side shows the equivalent field ("Verified driver · N trips"); the
  passenger side just never got the same treatment. `/api/admin/bootstrap`
  is correctly curl-only by design, not a gap.
- **`gnncab.nhtaxi.com`**: confirmed live via `curl` (200, serving the
  current Flutter web build) — `.tasks/handoff.md` had this listed as a
  pending "things only the user can do" item from before it was actually
  attached; corrected.
- Also caught and fixed one more instance of the stale-brand/em-dash
  cleanup from earlier: `apps/mobile/web/index.html`'s `<meta
  name="description">` is a separate static tag Flutter Web actually
  serves — it isn't populated from `pubspec.yaml`'s description, so the
  earlier pass had missed it.
- No TODO/FIXME anywhere in `apps/`/`packages/`. Working tree clean
  throughout — nothing mid-commit.

### A backup-artifact upload failure was quietly blocking every deploy
Fallout from the storage cleanup above: the next two pushes after deleting
the 37 stale APK artifacts both failed at `deploy.yml`'s "Upload D1 backup
artifact" step with `Failed to CreateArtifact: Artifact storage quota has
been hit` — GitHub's own account-level usage counter is cached and, per its
own error message, can take 6-12 hours to catch up even after the underlying
artifacts are gone. That single step failing killed the whole `deploy-api`
job, so "Apply D1 migrations" and "Deploy Worker" never ran for either
commit — neither had a schema change, so nothing was actually lost, but the
next commit that *did* need to reach production would have been silently
stuck the same way.

Root cause wasn't really the quota timing, it was that the workflow let a
non-essential step hold the real deploy hostage. D1 has its own built-in
Time Travel point-in-time restore on every plan, free tier included,
completely independent of Actions — this artifact was always a convenience
copy of the backup, never the only way to recover. Added
`continue-on-error: true` to just that upload step (the export itself still
always runs first). Verified live: the next push hit the identical quota
error on that exact step and the deploy still went through end to end,
migrations applied and Worker deployed. `api.nhtaxi.com` is caught up again.

### Repo renamed, secret-leak audit, README de-AI-ified
User wanted to make the repo public (to dodge GitHub's free-tier Actions
storage cap entirely — public repos have no such quota) and separately asked
for the repo to be renamed from `GNNcab-stack` to `gnncab-nhtaxi`. Did both,
but public visibility needed a real audit first, not a guess.

Audited for anything that would be a problem exposed: `.gitignore` coverage,
the **entire** git history (not just current files) for `.env`/`.dev.vars`
ever committed, wrangler.toml contents, Android signing config, `.npmrc`,
migrations for embedded data, README/scripts for real credentials. Found
exactly one issue: `.dev.vars.example` (tracked, meant to be a template) had
real-looking generated base64 values for `DOCUMENT_ENCRYPTION_KEY` and
`ADMIN_BOOTSTRAP_TOKEN` instead of an obvious placeholder — copy this file to
`.dev.vars` without editing it and you'd be running with a "random-looking"
key that isn't actually random to anyone who's seen the repo. Fixed to match
`JWT_SECRET`'s own `change-me-local-dev-only` placeholder style. Production
secrets are independently generated and pushed via `wrangler secret put`
(confirmed this is the established practice, not derived from this file), so
this was hygiene, not a live rotation — rotating `DOCUMENT_ENCRYPTION_KEY` for
real would break decryption of already-stored driver documents, so that was
deliberately not done. The tawk.to chat URL and the business's dispatch phone
number are already public-facing in the shipped app and aren't secrets.

Renamed the GitHub repo to `gnncab-nhtaxi` (`gh repo rename`) and updated the
local `origin` remote to match.

Separately, README.md read like AI-polished prose — heavy em-dash use,
justification-heavy asides. User asked for the reader-facing surface (README,
GitHub repo description, `pubspec.yaml` description) to be tightened, not the
in-code "why" comments the rest of the project deliberately keeps. Also
caught and fixed a real stale-brand bug this surfaced: the GitHub repo
description and `pubspec.yaml` still said "GNNcab" — internal resource names
keep that name on purpose (ADR 0009), but a public-facing description isn't
one of them.

### GitHub Actions storage quota: stopped building a debug APK on every push
A billing alert showed 100% of the 500MB free Actions storage used. Measured
it directly via the API rather than guessing: **2.94GB total, 99.97% of it
37 debug APKs** (~85MB each, 14-day retention) — D1 backups were 0.9MB and
Actions cache was 0 bytes (a separate 10GB quota from Actions storage anyway,
not part of this problem at all despite an outside AI's advice to "fix" it).

Root cause: `mobile.yml` built and uploaded an APK on every `apps/mobile/**`
push, and this repo has never used PRs (single branch, direct pushes to
`main`) — so `pull_request` never fired and every commit, including this
session's dozen-plus button/color/header tweaks, produced its own unrequested
APK. Fixed by splitting the workflow: `test` (analyze + flutter test) runs on
every push/PR as before with zero artifacts; the APK build moved to a new
`build-apk` job gated to `workflow_dispatch` only (manual "Run workflow" in
the Actions tab), retention cut 14→3 days. `deploy-web` (Pages) is untouched
— it was never part of the problem, since a Pages deploy isn't an Actions
artifact. Deleted the 37 existing APK artifacts via the API to reclaim the
quota immediately (2.94GB → 0.9MB) rather than waiting out retention.
Deliberately left D1 backup retention at 90 days — at 0.9MB total it isn't
the problem and won't be for a very long time at this data volume.

### One shared header on every screen, not a corner logo on one tab
The wordmark previously lived inside each shell's `AppBar.title`, and only on
tab index 0 — every other tab (Balance, Profile, Settings, Money...) showed a
plain text title with no branding at all. User feedback: too small, and
inconsistent from page to page ("bir sayfada çıkıyor bir sayfada çıkmıyor").

Added `widgets/brand_header_bar.dart` — a `BrandHeaderBar` (`PreferredSizeWidget`)
used as the `AppBar` for all three shells (`passenger_shell.dart`,
`driver_shell.dart`, `admin_shell.dart`) and the post-login `_ComingSoonScreen`
in `router.dart`. It centres a larger `BrandLogo` (40px, up from 24-28px) with
the current tab's name as a small subtitle underneath, on every tab — so the
header is now identical in structure everywhere, rather than one tab getting
special-cased. `flutter analyze` clean, 104/104 tests pass. Not yet confirmed
with a real screenshot — the Browser preview pane hit the same compositing
hiccup as an earlier round this session; worth a real look next time someone's
on a device or the tooling cooperates.

### Defined-but-dead: the standing list (start here for "what else is stubbed")
This category was surfaced late — a fair complaint. It tracks schema/columns
defined since an early phase that nothing at runtime actually writes or reads,
so a stub can't masquerade as a finished feature again.

- **`driver_profiles.rating`** — was dead since Faz 0 (read into a projection,
  never written; always null). **Resolved by the ratings feature above.**
- **`zones` + `driver_zone_assignments` tables** — **DELETED (migration 0011).**
  A polygon-geofence / zone-assignment layer copied faithfully from the
  original project's SRS, which itself marked it "Optional / Admin", and never
  wired to anything here. Dropped once the user confirmed, rather than left as
  a stub that reads as a working feature. The original design is preserved in
  `.memory-bank/audits/srs-architecture.md` if a future multi-city build ever
  wants it back.
- **Per-city columns** (`trips.city_id`, `driver_profiles.city_id`,
  `pricing_config.city_id`): trips are created with a null city, drivers never
  get one, and pricing always reads the global (`city_id IS NULL`) row.
  Multi-city / per-city-pricing infrastructure, deferred by the single-market
  decision. **Kept on purpose** — removing it means rebuilding `trips` /
  `pricing_config`, the exact dangerous operation that broke 0002/0007, for no
  benefit while there's one market.
- **`cities` / service areas** — a name+timezone label list; no dispatch or
  booking code reads a boundary. **The admin UI entry point was removed**
  (see below) once the user confirmed it was pure clutter; the backend CRUD
  (`/api/admin/cities`) and the Flutter providers are kept, inert, for when
  this is wired to something real.

## Known Incomplete Work
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
- **Report letterhead** — the GNN LLC address, tax number and logo on exported
  PDFs/CSVs are a `ReportOrg` seam (`core/report_export.dart`) that currently
  only fills in the name. The user will supply the real details; drop them into
  `ReportOrg.gnn` and every export picks them up.
- **Production admin not yet converted to the dual role.** `users.isAdmin` and
  the whole owner-operator path are built and inert; `info@nhtaxi.com` is still
  `role: "admin", isAdmin: false`. Converting it (to `role: "driver",
  isAdmin: true`) is a deliberate, user-confirmed, one-off **direct database
  change** — no API path grants `isAdmin`. Until then the admin-lockdown and
  dual-role gates are unproven live.
- **Brevo / FCM secrets** still unset in production, so email and push both take
  their silent no-op path. User-owned `wrangler secret put` (see
  `.specs/bootstrap.md`); nothing in the code needs touching once set.

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

As of commit `a1a39c9` (real NH Taxi branding assets),
everything below is deployed and verified against production.

- Backend: 204/204 vitest tests passing (real D1/DO via
  `@cloudflare/vitest-pool-workers`), `pnpm run typecheck` clean.
- Mobile: 104/104 Flutter tests passing, `flutter analyze` clean.
- CI `Deploy` + `Mobile` workflows green; live on `api.nhtaxi.com` and
  `gnncab-preview.pages.dev`.
- Migrations `0000`–`0011` all applied cleanly to remote D1. `0011` (drop the
  dead `zones` / `driver_zone_assignments` tables) was a rebuild-class op done
  child-first; `0010` (ratings) and everything money-reporting since were plain
  `ADD COLUMN` / new-endpoint work with no migration.
- Latest live smoke (money reporting + trip IDs): the deployed OpenAPI doc
  advertises `financial-summary`, `driver-earnings`, `trips/lookup`, and the
  `driverName`/`customerName` fields on `TripResponse`. **Not yet proven live:
  an actual PDF/CSV downloaded from the admin panel on the web build** — the
  export builders are unit-tested but the `share_plus` web download path wants a
  human click. Worth confirming a Turkish-named driver renders correctly in a
  real PDF once there is one.
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
  - Wave 3 shipped no backend change, so the live check was narrower:
    `/api/openapi.json` → 200 (Worker deployed cleanly) and an unauthenticated
    `/api/ws` upgrade → 401 (unchanged — this is the exact contract the new
    Flutter socket code depends on). **Not yet proven live: an actual driver
    broadcasting position and a passenger watching it move**, since that
    needs a real phone with GPS. Everything the client depends on the server
    still doing correctly was checked; the new client code itself wants a
    device test.
  - Brevo: registering a passenger and changing that account's password on
    production both still return 201/200 with the email calls wired in —
    proves the new `waitUntil`s don't break the request they ride on.
    **Not yet proven live: an email actually arriving anywhere.** `BREVO_API_KEY`
    isn't set in production yet, so every send today takes the same no-op
    path the test suite exercises. Once the user runs
    `wrangler secret put BREVO_API_KEY`, register a test account and confirm
    the welcome email and the admin notice both land.
  - Path verification: the new endpoint is present in the live OpenAPI doc
    and an unauthenticated request → 401 (route exists, auth gate holds).
    Migration `0008` applied cleanly to remote D1. **Not yet proven live: a
    real MISMATCHED flag on a real trip** — the automated route tests plant
    the mismatching breadcrumb by hand; a genuine test would want a real
    phone driving somewhere other than the booked pickup.

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
