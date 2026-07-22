# Handoff

- **Current mode**: Interactive
- **Current branch**: `main`
- **Last commit**: `4e246d5` — "Add short trip IDs, admin trip lookup, and
  richer report rows" (this doc-overhaul commit lands on top of it).
- **Worktree status**: clean, pushed, deployed. Deploy + Mobile CI both green
  on `4e246d5`.
- **What changed** (most recent first — full history in
  `.memory-bank/changelog/verified-worklog.md`):
  - **Short trip IDs + admin lookup + richer reports** (`4e246d5`): first-8-char
    trip code everywhere with a Copy button; admin "Find a trip by ID" prefix
    search (`GET /api/admin/trips/lookup`); report trip rows now show passenger,
    driver and route, not a bare UUID; new admin "Trip & fare report" export.
  - **Money reporting, CSV + PDF** (`881d0ca`, `587b014`, `cfecb95`): period
    `financial-summary` + `driver-earnings` endpoints; Flutter builds CSV & PDF
    client-side from one `ReportTable`; Roboto embedded for Turkish names; all
    report text switched to ASCII punctuation so nothing boxes.
  - **Names in trip history** (`0ab1e93`): each side sees who they rode with.
  - **Driver car marker** (`d8e54bc`, `54bf1d1`): top-view taxi that rotates to
    heading, status pip in the corner.
- **What was verified**: 204/204 backend vitest, 100/100 Flutter, `typecheck`
  + `analyze` clean, both CI workflows green, migrations `0000`–`0011` applied
  cleanly to remote D1. Live: deployed OpenAPI advertises the new endpoints and
  the `driverName`/`customerName` fields.
- **Known failures**: none open (see `.memory-bank/bugs/bug-list.md`).
- **Suggested validation commands**:
  - `pnpm run typecheck`
  - `cd apps/api && pnpm vitest run`
  - `cd apps/mobile && flutter analyze && flutter test`
- **Next recommended action**: no committed feature is mid-flight. The product
  is functionally complete for the current scope; likely next work is whatever
  the user surfaces from real-world testing, plus the user-owned items below.
  Before writing code, present a plan (the user works plan-first).
- **Not yet proven live** (needs a real device or the admin account):
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
  - Attach `gnncab.nhtaxi.com` to the `gnncab-preview` Pages project.
  - Convert `info@nhtaxi.com` to `role:"driver", isAdmin:true` (ADR 0008) — a
    deliberate one-off DB change.
  - Firebase project + `flutterfire configure` to deliver push.
  - Supply the GNN LLC report letterhead (address / tax no / logo) for
    `ReportOrg` (ADR 0007).
  - Clean the `smoke-*` test accounts/drivers from production D1.
