# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `48dab10` — "Rebrand the app from GNNcab to NH Taxi"
- **Worktree status**: clean, pushed, deployed. Deploy + Mobile CI both green
  on `fd19933`. Live-confirmed: `api.nhtaxi.com`'s OpenAPI doc title reads
  "NH Taxi API".
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
  - **Rebrand to NH Taxi** (`48dab10`): every user-visible string (UI, legal
    terms, emails, OpenAPI title) and the app's technical identity (Android
    `applicationId` `com.gnncab.gnncab`→`com.nhtaxi.app`, Flutter package
    `gnncab`→`nhtaxi`) — done now because no app-store listing exists yet
    (the one free window). Repo folder, Worker/D1/R2 names and the
    `gnncab.nhtaxi.com` preview subdomain deliberately untouched — see ADR 0009.
  - **Trip & fare report fix** (`1fc1f17`): cancelled/timed-out trips no
    longer count toward the money TOTAL or read "Referred: Y" (commission is
    only ever charged at TRIP_COMPLETED) — a new Status column keeps them
    visible without polluting the figure.
  - **Short trip IDs + admin lookup + richer reports** (`4e246d5`): first-8-char
    trip code everywhere with a Copy button; admin "Find a trip by ID" prefix
    search; report rows show passenger/driver/route, not a bare UUID.
  - **Money reporting, CSV + PDF** (`881d0ca`, `587b014`, `cfecb95`): period
    `financial-summary` + `driver-earnings` endpoints; client-side CSV/PDF
    from one `ReportTable`; Roboto embedded; ASCII-only report text.
- **What was verified locally for `48dab10`**: `pnpm run typecheck` clean,
  204/204 backend vitest, 103/103 Flutter tests, `flutter analyze` clean,
  `flutter pub get` resolved cleanly under the renamed package.
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: no committed feature is mid-flight. The user is
  supplying an NH Taxi logo (PNG, square, transparent, >=1024x1024) to drop at
  `apps/mobile/assets/logo/nhtaxi-logo.png` — once it lands, wire it into the
  app icon (Android mipmaps + web favicon/manifest icons) and the PDF report
  letterhead (`ReportOrg.logo` seam, ADR 0007). Otherwise, next work is
  whatever the user surfaces from real-world testing, plus the user-owned
  items below. Present a plan before writing code on anything non-trivial.
- **Not yet proven live** (needs a real device or the admin account):
  - The rebranded APK installing/running under `com.nhtaxi.app` (fresh CI
    artifact `nhtaxi-debug-apk`) — a device with the OLD `com.gnncab.gnncab`
    build installed will treat the new id as a **different app** (fresh
    install, not an update); expected and harmless, nothing has shipped to
    real users yet.
  - A PDF/CSV actually downloaded from the admin panel on the web build
    (`share_plus` web path); confirm a Turkish-named driver renders in a PDF.
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
  - Firebase project + `flutterfire configure` to deliver push. Note: the
    Android `applicationId` just changed to `com.nhtaxi.app` — use that value
    when registering the Android app in the Firebase console.
  - Supply the GNN LLC report letterhead (address / tax no / logo) for
    `ReportOrg` (ADR 0007).
  - Clean the `smoke-*` test accounts/drivers from production D1.
