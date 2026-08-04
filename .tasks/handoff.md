# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: pending — this memory-bank consistency pass itself isn't
  committed as of this line. Check `git log -1` to see the real HEAD.
- **Repo identity (single source of truth — ignore anything elsewhere that
  disagrees)**:
  - GitHub: **public**, `https://github.com/BigDesigner/project-nhtaxi`.
    Renamed twice: `GNNcab-stack` → `gnncab-nhtaxi` → `project-nhtaxi`. Old
    URLs auto-redirect for a while; use the current one.
  - Local clone folder: `C:\Users\bigde\.antigravity\project-nhtaxi`
    (renamed from `GNNcab-stack` to match — a straight folder rename was
    blocked by Windows file locks from the active session, so it was done
    via `robocopy` to the new path instead; the old folder may still exist
    on disk until the user deletes it manually, but it's not the working
    copy anymore).
  - `origin` remote and everything in the repo's own docs point at the
    current name/path as of this commit.
  - Precautions taken for being public (see the changelog for the full
    story): GitHub's own secret scanning + push protection enabled via the
    API, and a new `.githooks/pre-commit` hook blocks commits containing
    credential-shaped filenames, private-key blocks, known token prefixes,
    or real-looking `KEY=<value>` assignments. Already active
    (`core.hooksPath` = `.githooks`). Re-run the public-repo security audit
    checklist (full git history scan, `.gitignore` coverage, wrangler.toml,
    Android signing, npmrc) after any change touching config/secrets/CI —
    it's a baseline to re-check, not a one-time pass.
- **Worktree status**: check `git status` — a memory-bank-only commit may
  still be pending as of this line.
- **A full status audit was run recently** (user asked: is CI clean, is
  anything half-done, is anything built server-side but never wired to the
  app, is anything mid-flight). Findings, so a fresh agent doesn't have to
  redo this from scratch:
  - **CI**: clean, both `Deploy` and `Mobile` green as of the last several
    commits.
  - **Backend/frontend wiring**: every endpoint in the live OpenAPI spec
    (55 total) was cross-checked one by one against `apps/mobile/lib` call
    sites — all wired. `/api/admin/bootstrap` is deliberately curl-only (see
    "Things only the user can do" — no, wait, it needs no secret, it's just
    not an app screen by design).
  - No TODO/FIXME comments anywhere in `apps/`/`packages/`. Nothing is
    mid-commit or half-applied.
- **Production database was reset for launch** (executed live via a
  `workflow_dispatch` GitHub Action, `db-reset.yml`; verified after:
  `users: 1, remaining_email: "info@nhtaxi.com", trips: 0, drivers: 0,
  customers: 0, audit_logs: 0`). Every trip/driver/customer/session/
  document/rating/commission/collection row is gone; only the
  `info@nhtaxi.com` admin account survives. Not a targeted "delete smoke-*
  accounts" cleanup — it's everything except that one account, on the
  user's explicit instruction to launch fresh. **Not touched**: `cities`,
  `pricing_config` (real business config, not test data). **Not done,
  optional follow-up**: the actual driver-document files in the
  `gnncab-driver-documents` R2 bucket are still there (the deleted
  `driver_documents` rows pointed at them; `wrangler r2 object` has no bulk
  delete, so purging those needs a small one-off script). To redo this
  reset later: `gh workflow run "Database Reset" -f confirm=RESET`, or from
  the Actions tab.
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
  - **Memory-bank consistency pass** (this commit): user asked for every
    `.md` file to be accurate enough that a different agent could pick up
    the project cold. Fixed: `AGENTS.md` no longer claims "GNNcab" is in
    the repo folder name (it isn't, since the folder rename); added a
    repo-identity/public-repo callout there too; corrected the "Things only
    the user can do" list (the stale "attach gnncab.nhtaxi.com" entry was
    already done, removed rather than left as noise). Rewrote this file
    top-to-bottom — it had accumulated duplicate "repo renamed" notes from
    incremental edits across several commits, consolidated into one
    section. Refreshed `.memory-bank/bugs/bug-list.md`'s stale commit/test
    references. Root `package.json`'s `name` field also updated to
    `project-nhtaxi` (a local uncommitted edit already present when this
    pass started — kept, not reverted; internal `@gnncab/*` pnpm package
    scopes are deliberately untouched per ADR 0009, this is just the root
    label).
  - **Repo went public + renamed to project-nhtaxi + secret-scan
    precautions** (`3bd0b0e` and the commit before it): see the "Repo
    identity" section above for the current state; the changelog has the
    full story of what was enabled and why.
  - **`.archive/docs-migration/` retired** (`4e05d1d`): the folder holding
    the original pre-rebuild planning docs is gone. Everything in it was
    verified captured first — the locked decisions live across ADR
    0001/0002 already, plus a new **ADR 0010** (domain topology + Trackcar
    cutover plan, written up in full for the first time), and the legacy
    SRS's `zones`/`driver_zone_assignments` design was added to
    `.memory-bank/audits/srs-architecture.md`. Every reference to the old
    path was updated.
  - **Deploy no longer blocked by an Actions storage hiccup** (`5c735e9`):
    two deploys in a row failed because a pre-deploy D1 backup artifact
    upload hit GitHub's own stale storage-quota counter (can lag 6-12 hours
    after a cleanup) and killed the whole job before the actual deploy ran.
    Added `continue-on-error: true` to just that upload step — D1's own
    built-in Time Travel point-in-time restore is the real safety net,
    independent of Actions entirely. Confirmed live: the next deploy hit
    the identical quota error on that step and still deployed successfully.
  - **README/description cleanup + public-repo security audit** (`a32c294`,
    `b5a84b5`): full audit (gitignore coverage, entire git history for
    ever-committed secrets, wrangler.toml, Android signing, npmrc,
    migrations) — clean except one thing: `.dev.vars.example` carried
    real-looking generated values instead of an obvious placeholder. Fixed;
    production secrets are independently generated via `wrangler secret
    put`, never derived from this file, so this was hygiene, not a live
    rotation. Also: README rewritten with fewer em-dashes and less
    justification-heavy phrasing; GitHub repo description and
    `pubspec.yaml` fixed from a stale "GNNcab" mention to "NH Taxi".
  - **GitHub Actions storage fix** (`c5e8c82`): a billing alert showed 100%
    of the 500MB free Actions storage used. Measured directly via the API:
    2.94GB, 99.97% of it 37 debug APKs from `mobile.yml` building one on
    every `apps/mobile/**` push (this repo has never used PRs, so
    `pull_request` never gated anything). Split the workflow — analyze+test
    still run on every push, the APK build is now `workflow_dispatch`-only
    with 3-day retention. Deleted the 37 existing APK artifacts. **If you
    need a debug APK to test on an emulator, trigger it manually**: GitHub
    → Actions tab → Mobile workflow → Run workflow.
  - **Passenger "Trips taken" on the Profile tab** (`2d65ad6`): `GET
    /api/customer/profile` had always existed but was never called from
    the app. Added `customerProfileProvider` + a row matching the driver
    side's existing "Verified driver · N trips".
  - **One shared header on every screen** (`45d2e50`): the wordmark used to
    live only in tab 0's `AppBar` per shell. Added `widgets/
    brand_header_bar.dart`, used on every tab of every shell — centered
    40px logo + the tab name as a subtitle.
  - **Removed the "Service areas" admin screen** (`b16f58a`): traced end to
    end that a "service area" determines nothing in this codebase. Deleted
    the UI entry point; **kept** the backend and Flutter providers,
    commented, as the reusable base if this is ever wired to a real
    geofence feature.
  - **Filled buttons + amber-on-amber icon fix** (`4332b98`): several
    real-action buttons were secondary-styled `OutlinedButton`s next to a
    confident amber "Sign in"; a few icon badges had a pale-tint circle
    behind a full-strength same-colour icon, nearly invisible. Converted to
    plain filled buttons and solid accent-colour circles with a
    contrast-computed icon colour.
  - **Contrast fix: link text black, not amber** (`2c2f371`): after the
    amber theme landed, every plain-text button was amber-on-white — fixed
    at the theme level so every call site inherited it.
  - **Theme colour: amber, not green** (`1827311`): sampled the actual
    taxi-yellow from the logo art (`#FCC803`) as the Material 3 seed.
  - **Real branding assets** (`a1a39c9`): the user's actual NH Taxi artwork
    wired into the app icon, splash screen, in-app logo, and PDF report
    header.
  - **Rebrand to NH Taxi** (`48dab10`, `fd19933`, `42ad077`): every
    user-visible string + the app's technical identity
    (`com.gnncab.gnncab`→`com.nhtaxi.app`, Dart package `gnncab`→`nhtaxi`).
    See ADR 0009.
  - **Trip & fare report fix** (`1fc1f17`): cancelled/timed-out trips no
    longer count toward the money TOTAL.
  - **Short trip IDs + admin lookup + richer reports** (`4e246d5`).
  - **Money reporting, CSV + PDF** (`881d0ca`, `587b014`, `cfecb95`).
- **What was verified locally (most recent commits)**: `pnpm run
  typecheck`, backend `pnpm vitest run` (204/204), `flutter analyze` clean,
  `flutter test` (104/104). CI green on every commit through the last push.
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: **nothing code-side is left.** Every backend
  endpoint is wired to the app, CI is green, the deploy pipeline is caught
  up, production has been reset to a blank slate for launch, and the repo
  is public with secret-leak precautions in place. Everything still open is
  either (1) needs a real device/browser to eyeball — see "Not yet proven
  live" below, the Browser-pane compositing bug has blocked every agent
  attempt at this so far, it needs an actual device, not another agent
  retry — or (2) needs the user directly (secrets, a business decision, or
  real data they haven't supplied yet) — see "Things only the user can do"
  below. Outside of those two categories and the iOS/Android app-store +
  Firebase setup work, there is no known remaining gap. Next work is
  whatever the user surfaces from real-world testing. Present a plan before
  writing code on anything non-trivial.
- **Not yet proven live / on-device**:
  - **"Trips taken" on the passenger Profile tab** (`2d65ad6`) — needs a
    real logged-in passenger with completed trips to confirm.
  - **The `BrandHeaderBar`** — centered logo + tab-name subtitle on every
    tab of every shell — needs a real logged-in look at each role.
  - **Screens from an earlier commit** (`4332b98`) — Sign out buttons, the
    Money export row, "Export my earnings", the "Assign a job" phone icon,
    the "Request a trip" card icon — not screenshotted due to the
    Browser-pane hiccup.
  - The Android app icon and splash screen on an actual installed **native
    APK** — user confirmed the PWA (web app) runs fine on a real device,
    which covers the everyday path; the native build itself is still
    unverified but no longer a blocker.
  - The rebranded APK installing/running under `com.nhtaxi.app` — the debug
    APK build is manual only now (GitHub → Actions → Mobile → Run
    workflow); trigger one when actually wanted. A device with the OLD
    `com.gnncab.gnncab` build installed will treat the new id as a
    **different app** (fresh install, not an update) — expected, harmless.
  - A PDF actually downloaded from the admin panel showing the new logo in
    its header (unit-tested that the asset resolves; not yet eyeballed in a
    real generated PDF).
  - The referral happy path (needs an approved driver).
  - A driver broadcasting GPS and a passenger watching it move.
  - The admin-lockdown gate itself (`info@nhtaxi.com` is already the live
    admin — this is about exercising the lockdown behavior, not creating
    the account) + the optional dual-role conversion, if that's ever
    wanted.
- **Local `wrangler` CLI may not reach production from this machine**: the
  OAuth session that was authenticated here (`bigdesigner@gmail.com`)
  authenticates against Cloudflare account `c3bd4d79...`, but this
  project's Worker/D1 live under a *different* account, `a7a3a64d...` (per
  `wrangler.toml`'s `database_id`). `wrangler secret list` / `wrangler d1
  list` both failed with an auth error because of this. Anything needing
  real Cloudflare access — checking which secrets are set, running ad hoc
  D1 queries — has to go through a GitHub Actions workflow using the repo's
  `CLOUDFLARE_API_TOKEN` (see `.github/workflows/db-reset.yml` for the
  pattern), not a local wrangler command, unless someone re-runs `wrangler
  login` and picks the right account. Verify this is still true before
  assuming it — it depends on which Cloudflare account is logged in
  locally, which can change.
- **Things only the user can do**:
  - `wrangler secret put BREVO_API_KEY` — user says this is already set.
    **Unverified from here**: local wrangler can't list secrets (see
    above), and there's no email inbox to check against. Cheapest real
    test: send a real trip-completion or registration and confirm an email
    actually arrives (`lib/trip-emails.ts`/`lib/email.ts` call Brevo; they
    no-op silently on any failure, so "no error in logs" doesn't prove
    delivery).
  - `wrangler secret put FCM_SERVICE_ACCOUNT_KEY` — **not the same thing as
    Brevo**. Firebase's own service-account JSON (Firebase Console →
    Project Settings → Service Accounts → Generate new private key),
    entirely separate from email — used to sign requests to Firebase Cloud
    Messaging. Bundled with the rest of the Firebase setup the user has
    already scoped out for later.
  - Move `ROUTING_BASE_URL` off the public OSRM demo before real volume.
  - **Clarification, not a to-do**: `info@nhtaxi.com` is *already* the
    admin account (`role: "admin"`) — that's what the user logs into the
    admin panel with today. The actual optional item from ADR 0008 is
    different: converting it to `role: "driver", isAdmin: true` instead, so
    the same login could *also* drive. Undecided — only relevant if the
    same person who runs the office also wants to drive under this
    account. No action needed unless that's wanted.
  - **GNN LLC report letterhead (address / tax no) for `ReportOrg`** — user
    will supply this later (the logo image itself is already wired — ADR
    0007). Tracked, not forgotten.
  - Optional follow-up, not asked for yet: purge the orphaned driver-
    document files from the `gnncab-driver-documents` R2 bucket (see
    "Production database was reset for launch" above).
  - Delete the old local folder at `C:\Users\bigde\.antigravity\
    GNNcab-stack` if it still exists — it was superseded by `project-
    nhtaxi` via a copy (not a move, since Windows had it locked), so both
    may exist on disk until manually cleaned up. Not urgent, just clutter.
