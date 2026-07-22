# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `1827311` — "Use the logo's taxi-yellow as the app's
  accent colour, not green"
- **Worktree status**: clean, committed locally. Push + CI watch is the very
  next step, not yet done as of this line — check `git log origin/main` /
  `gh run list` to see whether that already happened by the time you're
  reading this.
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
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
- **What was verified locally for `1827311`**: `flutter analyze` clean,
  104/104 Flutter tests. Visually confirmed in a local `flutter build web` +
  static serve (DWDS dev-mode `flutter run` hung on this machine — use
  `flutter build web` + `npx serve build/web` for any future visual check,
  see `.claude/launch.json`): splash renders correctly on white, the browser
  tab reads "NH Taxi", the login screen's wordmark is undistorted, and the
  `Sign in` button + text links read as rich amber-gold (`#FCC803`), not
  green, not pale yellow.
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: push `1827311`, watch `Deploy` + `Mobile` CI
  (Mobile will touch it; Deploy runs on every push regardless), then
  ideally have the user (or a real device) confirm the Android app icon,
  splash and the new amber theme actually look right on a phone — the CLI
  verification above proves the files generated and wired correctly, but
  this is ultimately a visual, on-device judgment call the user should sign
  off on. After that, no committed feature is mid-flight — next work is
  whatever the user surfaces from real-world testing. Present a plan before
  writing code on anything non-trivial.
- **Not yet proven live / on-device**:
  - The Android app icon and splash screen on an actual installed APK (only
    verified via generated-file inspection + a web build's favicon/splash).
  - The rebranded APK installing/running under `com.nhtaxi.app` (fresh CI
    artifact `nhtaxi-debug-apk`) — a device with the OLD `com.gnncab.gnncab`
    build installed will treat the new id as a **different app** (fresh
    install, not an update); expected and harmless, nothing has shipped to
    real users yet.
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
  - Attach `gnncab.nhtaxi.com` to the `gnncab-preview` Pages project now (or
    swap it for `app.nhtaxi.com` once the legacy Trackcar app is retired —
    see ADR 0009).
  - Convert `info@nhtaxi.com` to `role:"driver", isAdmin:true` (ADR 0008) — a
    deliberate one-off DB change.
  - Firebase project + `flutterfire configure` to deliver push. Use
    `com.nhtaxi.app` as the Android app id when registering in Firebase.
  - Supply the GNN LLC report letterhead (address / tax no) for `ReportOrg`
    (the logo image itself is now wired — ADR 0007).
  - Clean the `smoke-*` test accounts/drivers from production D1.
  - Confirm the Android icon/splash/amber theme look right on a real device
    once convenient — this needs eyes on a phone, not CI.
