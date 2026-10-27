# Handoff

- **Updated**: 2026-10-27; interactive; branch `main`.
- **Maintenance base**: `00bf1e1`; freshly fetched `origin/main` matched 0/0.
- **Current maintenance commit**: recorded after the implementation commit.
- **Repository**: public, `https://github.com/BigDesigner/project-nhtaxi`.
- **Workspace**: `C:\Users\bigde\.antigravity\project-nhtaxi`; one worktree.
- **Local pre-existing files**: two untracked old audit reports,
  `audit-4e246d5.md` and `audit-a5b1791.md`, preserved unchanged.

## Latest changes

Dependency/security maintenance is implemented. See
`.memory-bank/audits/maintenance-2026-10-27.md` for versions, rationale,
validation and deliberate version holds; raw npm/Flutter reports are beside it.

- API runtime dependencies and test/deploy tools updated; full npm audit zero.
- Cloudflare Vitest plugin replaces the retired pool package; Vitest 5.
- Flutter compatible dependencies refreshed; licensed PDF fonts bundled locally.
- HTTP size limits/security headers; framework errors preserve HTTP status.
- Updated Actions, locked deployment tools, lockfile enforcement and Dependabot.
- Plaintext D1 backup artifact uploads removed. One old artifact deleted with
  explicit user approval; zero artifacts remained immediately afterward.
- **Recovery**: pre-deploy export stays only on the ephemeral runner; durable
  recovery is D1 Time Travel, **7 days on Free**. Longer retention requires a
  private encrypted destination (ADR 0011). No production reset was performed.

## Validation

- Workspace TypeScript: clean.
- Backend: 209/209 tests, 38 files.
- Flutter analysis: clean; tests 105/105.
- Full and production npm audits: zero known advisories.
- Worker dry-run and release web build: passed.
- Drizzle generation: passed, no schema changes or new migrations.
- Android, CI and live smoke: final outcomes recorded after completion.

## Next action

Resume feature development or device testing after reading the maintenance
report. Present a plan before sizeable changes. Follow-up hardening includes
private longer-term backups and durable HTTP auth-abuse throttling; this
maintenance did not implement authentication rate limiting. TypeScript 7 and
Flutter router 18 / secure-storage 11 / UI migrations are explicitly held for
separate compatibility/device validation, not silently forgotten.

## Production context retained from the previous handoff

Production was reset for launch earlier: only `info@nhtaxi.com` admin survived;
cities/pricing were retained. This is historical context, not a claim that the
production database still has one user today. No new row counts were queried.
R2 may still contain orphaned files from that historical reset; no purge was run.

`info@nhtaxi.com` is already an admin. Optional dual-role conversion to
`role: driver, isAdmin: true` is a deliberate user decision, not a missing setup
step. Resource names keep `gnncab` for compatibility (ADR 0009). Domain cutover
from Trackcar is governed by ADR 0010; do not repoint `app.` or `tracker.` early.

## User-owned setup and device checks

- Rotate the admin password through the app as a precaution: the removed public
  backup could have contained account hashes. Its contents/access were not
  inspected, so no claim of confirmed credential compromise is made.
- Firebase project, `flutterfire configure`, FCM service account secret and real
  push delivery remain pending. Never ask for or print secrets.
- User previously said Brevo was configured; actual welcome/trip email delivery
  still needs a real inbox check. Successful requests alone do not prove mail.
- Replace public OSRM demo routing before real volume; routing fails closed.
- Supply report address/tax number when wanted. Real branding assets are wired.
- Device checks: referral happy path with approved driver; live driver GPS to a
  passenger; admin/dual-role behavior; PDF/CSV download/share; branded headers,
  native icon/splash and native APK installation. Automated builds do not prove
  these physical-device interactions. PWA operation was previously confirmed.
- App-store signing and iOS project setup remain out of scope for this pass.

## Environment notes

- Local Wrangler historically authenticated to another Cloudflare account;
  use the repository's authenticated deployment workflow for production. Never
  assume local CLI auth reaches this D1. No secrets were read or changed here.
- Windows Flutter tests initially hit a read-only generated asset directory;
  removing only workspace-local `build/unit_test_assets` fixed it.
- Git hooks remain enabled; commit anonymity and secret review still apply.
