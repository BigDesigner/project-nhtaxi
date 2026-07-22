# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `4332b98` — "Make every real action a filled amber
  button, fix amber-on-amber icons"
- **Worktree status**: clean, committed locally. Push + CI watch is the very
  next step, not yet done as of this line — check `git log origin/main` /
  `gh run list` to see whether that already happened by the time you're
  reading this.
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
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
- **What was verified locally for `4332b98`**: `flutter analyze` clean,
  104/104 Flutter tests. The login screen (same `flutter build web` + static
  serve approach — see `.claude/launch.json`) was re-confirmed unchanged.
  **Not re-screenshotted this round** — the Browser preview pane stopped
  compositing frames (tooling hiccup, not a code issue) right when it would
  have shown the post-login screens (Sign out, Export buttons, the icon
  badges) that this commit actually touches, and reaching those needs a real
  login this environment has no test credentials for. Confidence is high
  anyway: the 6 button conversions are the exact same `FilledButton` widget
  already visually confirmed correct for `Sign in` (zero custom styling
  added, so there's no new rendering path to distrust), and the icon-circle
  fix uses `ThemeData.estimateBrightnessForColor` in its standard documented
  way (the same utility Flutter's own AppBar/SnackBar theming uses to pick
  contrasting content). **Worth a real look next time someone's logged in.**
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: push `4332b98`, watch `Deploy` + `Mobile` CI,
  then get a real logged-in look (any role) at: the "Sign out" buttons, the
  admin Money "Export reports" row, "Export my earnings", the admin "Assign
  a job" phone icon, and the passenger "Request a trip" card icon — this
  round's changes were verified by code/API-correctness reasoning, not a
  fresh screenshot (see above), so they're the first thing to double-check
  once someone can actually log in. Also worth a real device check of the
  Android app icon/splash/amber theme in general. After that, no committed
  feature is mid-flight — next work is whatever the user surfaces from
  real-world testing. Present a plan before writing code on anything
  non-trivial.
- **Not yet proven live / on-device**:
  - **This commit's actual screens** — Sign out buttons, the Money export
    row, "Export my earnings", the "Assign a job" phone icon, the "Request a
    trip" card icon — need a real logged-in look (see above; not
    screenshotted this round due to a Browser-pane tooling hiccup).
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
