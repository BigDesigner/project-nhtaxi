# Dependency and readiness maintenance — 2026-10-27

## Scope and starting state

User approved dependency/security maintenance before resuming development.
One worktree, `main` at `00bf1e1`, matched freshly fetched `origin/main` (0/0).
Two pre-existing untracked historical audit reports were preserved unchanged:
`audit-4e246d5.md` and `audit-a5b1791.md`. Their blanket assurances were not
used as evidence of present security.

Baseline: TypeScript and Flutter analysis passed; Flutter 104/104 passed.
Backend 203/204 passed, with one 5s dispatch-alarm timeout; its file passed
5/5 in isolation. Initial sandbox-only Workers startup errors disappeared
when the runner had its required filesystem/process permissions.

## Changes

| Area | Result |
| --- | --- |
| API dependencies | Hono 4.13.14, Zod 4.6.7, zod-openapi 1.6.3, Drizzle ORM 0.45.4 |
| API tools | Wrangler 4.153.0, Vitest 5.0.5, Cloudflare Vitest plugin 1.4.8, drizzle-kit 0.31.11, tsx 4.23.15 |
| Types | Workers 5.20261026.1; Node types 24.19.2 to match CI/local Node major |
| Flutter | 74 resolved dependency changes (including removed obsolete transitives), within existing constraints |
| Security audit | 43 npm advisories initially (11 high, 27 moderate, 5 low); final full and production audits: zero |
| HTTP | Security response headers; 64 KiB general request cap; 12 MiB upload cap, preserving route-level 10/2 MiB limits |
| Framework errors | Preserve HTTPException status; missing required JSON media type now correctly returns 415 instead of 500 |
| Test stability | At most four real workerd instances concurrently; 15s budget for the test exercising 15 alarm rounds |
| PDF | Bundled regular/bold Roboto and Apache license; no font-network dependency or silent Helvetica fallback |
| CI | Updated Actions, security audit gate, Flutter lockfile enforcement, shared pinned Wrangler for web/API |
| Maintenance | Weekly grouped Dependabot checks for npm, pub and Actions |

Security overrides retain patched Vite 8/PostCSS 8/nanoid 3/source-map-js 1.
Drizzle's retired loader brings esbuild 0.18; override that copy to 0.25.12.
`drizzle-kit generate` successfully reads all 17 tables and finds no schema
changes. The deprecated loader itself remains upstream; no package is hidden
with an advisory ignore. Review/remove overrides when upstream floors catch up.
The official Cloudflare plugin currently depends on Miniflare 5 beta; this is
test tooling, and the installed combination passed all real D1/DO tests.

## Public database artifact finding

Found retained artifact ID `8879064393`, named `d1-backup-00bf1e1...`.
It was not downloaded. Plaintext exports may contain account hashes, sessions
and personal data; no claim is made about its specific contents or access.
The user explicitly approved deletion. GitHub DELETE succeeded; the subsequent
artifact listing returned **0**. Both deploy and manual-reset workflows no
longer upload SQL exports. Export paths are now gitignored.

[ADR 0011](../adr/0011-private-database-recovery.md) records the recovery
tradeoff: ephemeral exports plus D1 Time Travel, **7 days on Free**. Longer
retention still needs private, encrypted storage. The database was not reset
or restored. Admin password rotation through the app is recommended as a
precaution; no secrets were requested, printed or rotated.

## Validation

- Frozen pnpm install: passed.
- Full npm audit and production-only audit: zero known advisories.
- Workspace TypeScript: passed.
- Backend: **209/209**, 38 files, including five new HTTP-boundary tests.
- Flutter analysis: passed.
- Flutter tests: **105/105**, including font glyph coverage.
- Flutter release web build: passed, including Wasm compatibility dry run.
- Worker deployment dry run: passed (240.29 KiB gzip).
- Drizzle migration generation: passed; no new migrations.
- Android debug APK (ARM32/ARM64/x86_64): passed, 552s including missing SDK/CMake component installs.
- CI on `e0ea4b3`: Deploy and Mobile succeeded; API and web deployments completed.
- Live API: health/OpenAPI 200, anonymous driver 401, unsupported media 415, oversized login 413, allowed web CORS preflight 204. Security headers verified.
- Full CI and live-check evidence: `ci-results-2026-10-27.json` and `live-smoke-2026-10-27.json`.

Windows test startup initially failed on a read-only generated
`build/unit_test_assets` directory. Removed only that verified workspace-local
cache with PowerShell; subsequent tests passed. No SDK/global setting changed.
Gradle subsequently installed missing Android platform components 34/35 and CMake 3.22.1 using
the machine's already accepted licenses; Flutter itself was not upgraded.

## Deliberate version holds and practical limits

- TypeScript remains 5.9.3 (`~5.9.3`): moving to compiler 7 is a separate
  compatibility migration, not required to fix these advisories.
- Node types stay on 24 to match Node 24; Node 26 types were previously
  mismatched. The machine's global Node/Flutter/pnpm installations were not upgraded.
- Flutter remains pinned at 3.44.6 / Dart 3.12.2. go_router 18 introduces the
  Material/Cupertino UI migration; secure-storage 11 removes legacy encrypted
  storage paths. Keep go_router 17.5.0 and secure-storage 10.3.4 until those
  migrations can be checked on installed devices. No device-data migration
  was attempted. Cupertino icons 2 also belongs with the UI migration.
- Android Gradle/Kotlin stay at the existing 9.0.1/2.3.20 combination while
  validating refreshed native plugins. Do not infer store-release readiness:
  release signing and iOS setup remain user-owned launch work.
- Advisory absence is a point-in-time dependency check, not proof of security.
  HTTP authentication throttling is not implemented by this maintenance pass;
  WebSocket per-connection rate limits remain. Evaluate durable auth-abuse
  controls separately before opening registration to significant traffic.
- Routing still uses the public OSRM demo; Firebase setup, actual push/email
  delivery, GPS/device flows and report letterhead remain as in handoff.

## Evidence and references

- `dependency-audit-2026-10-27.json`: full final npm advisory result.
- `npm-outdated-2026-10-27.json`, `flutter-outdated-2026-10-27.json`:
  remaining version differences, distinct from vulnerabilities.
- [Cloudflare testing migration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Secure storage migration](https://pub.dev/packages/flutter_secure_storage/changelog)
- [Router migration](https://pub.dev/packages/go_router/changelog)
- [D1 retention limits](https://developers.cloudflare.com/d1/platform/limits/)

## CI follow-up: pnpm installation

The first Deploy run for `d65b1a9` failed before tests: pnpm/action-setup 6
refused the repository's old pnpm 11.12.0 pin as a known broken release (its
standalone executable build is missing a binary). The local npm-installed
copy happened to work, which is why local validation did not expose this.
Pin pnpm 11.28.9 instead and validate its frozen installation explicitly;
no global package-manager installation is modified.
Mobile workflow path filters now include the three root package-manager/lock
files, because its deployment CLI comes from that workspace. Root tool changes
must revalidate web deployment even when Flutter source itself is unchanged.

## Deployment evidence

- Implementation: `d65b1a9`; pnpm correction: `56baf1c`; final CI trigger fix: `e0ea4b3`.
- [Deploy succeeded](https://github.com/BigDesigner/project-nhtaxi/actions/runs/40445063265).
- [Mobile succeeded](https://github.com/BigDesigner/project-nhtaxi/actions/runs/40445063318).
- Debug APK was built locally for all three Android architectures; the automatic
  workflow deliberately skips APK artifact creation (manual-only policy retained).
- Both old SQL artifact upload steps are absent; the artifact inventory was
  rechecked after deployment. No production smoke accounts or trips were created.
- Canonical web URL `https://gnncab.nhtaxi.com` returned 200 after deployment.
  Requests to the alternate `gnncab-preview.pages.dev` hostname were reset by
  the transport from this environment; do not count that URL as smoke-tested.
  The web deployment job itself succeeded. Final artifact inventory: zero.
- A following documentation-only commit records these results with `[skip ci]`;
  no application, dependency or workflow files change after verified `e0ea4b3`.
