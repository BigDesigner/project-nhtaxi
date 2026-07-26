# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `45b8274` — "Fix the last stale em-dash description:
  web/index.html"
- **Repo**: renamed on GitHub from `GNNcab-stack` to `gnncab-nhtaxi`
  (`https://github.com/BigDesigner/gnncab-nhtaxi`); local `origin` remote
  updated to match. GitHub auto-redirects the old URL for a while, but use
  the new one going forward.
- **Worktree status**: clean, committed and pushed. Both `Deploy` and
  `Mobile` CI green as of this commit — check `gh run list` if you want to
  confirm nothing regressed since.
- **A full status audit was run on this commit** (user asked: is CI clean,
  is anything half-done, is anything built server-side but never wired to
  the app, is anything mid-flight). Findings, so the next session doesn't
  have to redo this from scratch:
  - **CI**: clean. Two Deploy runs failed right after the Actions-storage
    cleanup (`b5a84b5`, `cbddbcb`) — diagnosed and fixed in `5c735e9`
    (see below); every run since is green.
  - **One real backend/frontend gap found**: `GET /api/customer/profile`
    (returns `totalTrips` + `preferredPaymentMethod`) is never called
    anywhere in `apps/mobile`. The passenger Profile tab shows email/phone/
    role from `/api/auth/me` only — no lifetime trip count, even though the
    driver side shows exactly this ("Verified driver · N trips") from the
    equivalent driver field. Cheap, low-risk addition if wanted: call this
    endpoint from `_ProfileTab` in `passenger_shell.dart` and add a trip-count
    line. `preferredPaymentMethod` is currently moot (cash is the only
    payment method — Stripe deferred), so that field has nothing to show yet.
  - Every other endpoint in the live OpenAPI spec (55 total) was cross-checked
    against `apps/mobile/lib` call sites one by one — all wired. `/api/admin/
    bootstrap` is deliberately curl-only (one-time setup, not an app screen).
  - **`gnncab.nhtaxi.com` is already live** serving the current Flutter web
    build (verified: `curl` returns 200, HTML matches the app) — the
    "Attach gnncab.nhtaxi.com" item further down in "Things only the user
    can do" was stale from before this was done; left the entry but this
    confirms it's already handled.
  - No TODO/FIXME comments anywhere in `apps/`/`packages/`. Bug list
    (`.memory-bank/bugs/bug-list.md`) is stale (references `4e246d5`) but its
    "no open bugs" verdict still holds — nothing since has introduced one.
  - Nothing is mid-commit or half-applied; `git status` is clean throughout.
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
  - **Deploy no longer blocked by an Actions storage hiccup** (`5c735e9`):
    the very next two deploys after the storage cleanup below (`b5a84b5`,
    `cbddbcb`) both failed outright — GitHub's own quota counter took longer
    than the artifact deletion to catch up ("recalculated every 6-12 hours",
    per its own error), so "Upload D1 backup artifact" failed and killed the
    whole `deploy-api` job, skipping migrations and the Worker deploy
    entirely for two commits in a row. Added `continue-on-error: true` to
    just that upload step — D1 has its own built-in Time Travel
    point-in-time restore on every plan (free tier included), so this
    artifact was always a convenience copy, not the only recovery path.
    Confirmed live: the very next deploy (`5c735e9` itself) hit the exact
    same quota error on that step and **still deployed successfully**.
    `api.nhtaxi.com` is now caught up on everything through this commit.
  - **README/description cleanup + public-repo security audit** (`a32c294`,
    `b5a84b5`): user asked to go through the repo for anything that would be
    a problem if it turned public, and separately to de-AI-ify the README's
    prose. Full audit (gitignore coverage, entire git history for ever-
    committed secrets, wrangler.toml, Android signing, npmrc, migrations):
    clean except one thing — `.dev.vars.example` carried real-looking
    generated values for `DOCUMENT_ENCRYPTION_KEY`/`ADMIN_BOOTSTRAP_TOKEN`
    instead of an obvious placeholder like `JWT_SECRET`'s own
    `change-me-local-dev-only`. Fixed (`b5a84b5`) — production secrets are
    independently generated and pushed via `wrangler secret put`, never
    derived from this file, so this was a hygiene fix, not a live rotation.
    Repo should be safe to make public now. README rewritten with fewer
    em-dashes and less justification-heavy phrasing; GitHub repo description
    and `pubspec.yaml` fixed from a stale "GNNcab" mention to "NH Taxi".
  - **GitHub Actions storage fix** (`c5e8c82`): a billing alert showed 100%
    of the 500MB free Actions storage used. Measured directly via the API
    (don't trust a diagnosis that only read the YAML): 2.94GB, 99.97% of it
    37 debug APKs from `mobile.yml` building one on every `apps/mobile/**`
    push (this repo has never used PRs, so `pull_request` never gated
    anything). Split the workflow — `test` (analyze+test) still runs on
    every push, the APK build is now `workflow_dispatch`-only with 3-day
    retention. Deleted the 37 existing APK artifacts via the API — quota is
    back to 0.9MB (just the harmless D1 backups, left alone; not the
    problem now or for a long time at current DB size). **If you need a
    debug APK to test on an emulator, trigger it manually**: GitHub →
    Actions tab → Mobile workflow → Run workflow.
  - **One shared header on every screen** (`45d2e50`): the wordmark used
    to live only in tab 0's `AppBar` per shell — every other tab had a plain
    text title, no branding. User feedback: too small, and inconsistent tab
    to tab. Added `widgets/brand_header_bar.dart`, used as the `AppBar` for
    all three shells + `_ComingSoonScreen` — centered 40px logo + the tab name
    as a subtitle, identical structure on every tab. `flutter analyze` clean,
    104/104 tests pass. **Not yet screenshotted** — the Browser preview pane
    hit the same compositing hiccup as the round below; needs a real look.
  - **Removed the "Service areas" admin screen** (`b16f58a`): traced end to
    end that a "service area" determines nothing (no dispatch/pricing code
    reads a city boundary, `trips.cityId` is never assigned, the
    passenger-facing coverage text is a hardcoded paragraph) — the user
    confirmed it was pure clutter and asked to remove it. Deleted the entry
    point + `_CitiesDialog` from the admin Settings tab; **kept** the
    backend (`/api/admin/cities`) and Flutter providers, commented, as the
    reusable base if this is ever wired to a real geofence feature.
  - **Filled buttons + amber-on-amber icon fix** (`4332b98`): "Sign out"
    (x4), "Export my earnings", and all 6 admin Money export buttons
    (Financial summary/Driver earnings/Trip & fare report/Balances/
    Commissions/Collections) were `OutlinedButton`/`FilledButton.tonalIcon` —
    looked secondary next to the confident amber `Sign in`. Converted to
    plain `FilledButton(.icon)`. Separately, a few icon badges ("Assign a job"
    phone icon, `_ActionCard`, `DriverAvatar`'s fallback) had a pale
    15%-tint circle behind a full-strength same-colour icon — amber-on-
    pale-amber, nearly invisible. Now solid accent-colour circle + a
    contrast-computed icon colour (`ThemeData.estimateBrightnessForColor`).
    The one green "online" badge with the same tint idiom was deliberately
    left — semantic status colour, not the brand accent.
  - **Contrast fix: link text black, not amber** (`2c2f371`): after the amber
    theme landed, every `TextButton`/`OutlinedButton` ("Sign up", "Drive with
    us", "Turn it down", terms links) was rendering amber-on-white — a real
    contrast failure, caught by the user testing on a bright screen. Fixed at
    the theme level (`textButtonTheme`/`outlinedButtonTheme` force black bold
    text), so every call site inherited it with no per-screen changes. Amber
    stays confined to solid fills (`FilledButton`, cards) as intended.
  - **Theme colour: amber, not green** (`1827311`): the Material 3 seed
    colour driving every button/accent was still the pre-rebrand dark green.
    Sampled the actual taxi-yellow from the logo art (`#FCC803`) and made it
    the seed, with `primary`/`onPrimary` forced explicitly to amber/black
    (fromSeed's own algorithm would have muted a bright yellow into dark
    gold otherwise). Verified visually — `Sign in` button and text links now
    read as a rich amber-gold, not pale yellow, not green. Semantic status
    colours (green=available, red=busy, etc.) untouched, deliberately.
  - **Real branding assets** (`a1a39c9`): the user's actual NH Taxi artwork
    (taxi + moose-head mark) wired in — Android/web app icon, splash screen,
    an in-app `BrandLogo` widget replacing plain "NH Taxi" text (login screen,
    passenger/driver home tab bars), and the PDF report header now actually
    renders a logo image (the rendering path didn't exist before, only the
    `ReportOrg.logo` data field). `flutter_launcher_icons` +
    `flutter_native_splash` added as dev deps to generate every size from one
    source each. iOS configured but skipped — `ios/` doesn't exist yet.
  - **Rebrand to NH Taxi** (`48dab10`, `fd19933`, `42ad077`): every
    user-visible string + the app's technical identity (`applicationId`
    `com.gnncab.gnncab`→`com.nhtaxi.app`, Dart package `gnncab`→`nhtaxi`).
    Live-confirmed: `api.nhtaxi.com`'s OpenAPI title reads "NH Taxi API". See
    ADR 0009.
  - **Trip & fare report fix** (`1fc1f17`): cancelled/timed-out trips no
    longer count toward the money TOTAL or read "Referred: Y".
  - **Short trip IDs + admin lookup + richer reports** (`4e246d5`).
  - **Money reporting, CSV + PDF** (`881d0ca`, `587b014`, `cfecb95`).
- **What was verified locally**:
  - Header-bar change: `flutter analyze` clean, 104/104 Flutter tests. No
    screenshot yet (Browser pane compositing hiccup) — reasoned from a
    straightforward `AppBar` swap using the already-proven `BrandLogo` widget.
  - `b16f58a`: `flutter analyze` clean, 104/104 Flutter tests (unchanged count
    — no widget test covered the removed dialog). Pure deletion + one
    comment; no new rendering path to distrust.
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: nothing is queued or mid-flight as of
  `45b8274` — CI is green, the deploy pipeline is caught up, the repo is
  audited clean for going public. The two concrete open items are (1) get a
  real logged-in look at everything in "Not yet proven live" below — the
  Browser-pane compositing bug has blocked every attempt at this so far,
  it needs an actual device/browser, not another agent retry — and (2) the
  `/api/customer/profile` gap above, only if the user wants a trip-count
  shown on the passenger Profile tab. Otherwise, next work is whatever the
  user surfaces from real-world testing. Present a plan before writing code
  on anything non-trivial.
- **Not yet proven live / on-device**:
  - **The new `BrandHeaderBar`** — centered logo + tab-name subtitle on every
    tab of every shell — needs a real logged-in look at each role.
  - **Screens from an earlier commit** (`4332b98`) — Sign out buttons, the Money export
    row, "Export my earnings", the "Assign a job" phone icon, the "Request a
    trip" card icon — need a real logged-in look (see above; not
    screenshotted due to the same Browser-pane hiccup).
  - The Android app icon and splash screen on an actual installed APK (only
    verified via generated-file inspection + a web build's favicon/splash).
  - The rebranded APK installing/running under `com.nhtaxi.app` — the debug
    APK build is now manual only (GitHub → Actions → Mobile → Run workflow,
    see the GitHub Actions storage fix above), so there's no fresh artifact
    sitting around; trigger one when you actually want to test on a device.
    A device with the OLD `com.gnncab.gnncab` build installed will treat the
    new id as a **different app** (fresh install, not an update); expected
    and harmless, nothing has shipped to real users yet.
  - A PDF actually downloaded from the admin panel showing the new logo in
    its header (unit-tested that the asset resolves; not yet eyeballed in a
    real generated PDF file).
  - The referral happy path (needs an approved driver).
  - A driver broadcasting GPS and a passenger watching it move.
  - The admin-lockdown + dual-role gates (need the production admin, or the
    dual-role conversion below).
- **Things only the user can do**:
  - `wrangler secret put BREVO_API_KEY` and `FCM_SERVICE_ACCOUNT_KEY`
    (email & push no-op silently until set).
  - Move `ROUTING_BASE_URL` off the public OSRM demo before real volume.
  - **Done, verified live** (`curl` returns 200, serving the current
    Flutter web build): `gnncab.nhtaxi.com` is attached to the
    `gnncab-preview` Pages project. Swap it for `app.nhtaxi.com` once the
    legacy Trackcar app is retired — see ADR 0009.
  - Convert `info@nhtaxi.com` to `role:"driver", isAdmin:true` (ADR 0008) — a
    deliberate one-off DB change.
  - Firebase project + `flutterfire configure` to deliver push. Use
    `com.nhtaxi.app` as the Android app id when registering in Firebase.
  - Supply the GNN LLC report letterhead (address / tax no) for `ReportOrg`
    (the logo image itself is now wired — ADR 0007).
  - Clean the `smoke-*` test accounts/drivers from production D1.
  - Confirm the Android icon/splash/amber theme look right on a real device
    once convenient — this needs eyes on a phone, not CI.
