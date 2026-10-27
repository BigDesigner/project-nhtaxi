# ADR 0007: Reports (CSV + PDF) are generated client-side in Flutter

- **Status**: Accepted
- **Confidence**: Verified
- **Date**: 2026-07-22 (decision locked during the money-reporting work; recorded here retroactively)

## Context
The business needs every financial figure exportable as a well-formatted CSV and PDF for accounting and tax filing — with titles, column headers, a totals row, a legend, and (later) a company letterhead. A report's underlying data is fetched from the API, which already requires network connectivity. The backend runs on the Cloudflare Workers free tier, where bundling a PDF library and rendering documents adds bundle weight and memory pressure for no real benefit.

## Decision
- The backend exposes the **data**: JSON aggregation endpoints (`financial-summary`, `driver-earnings`) and raw `?format=csv` on the per-row reports, for curl/accounting-tool imports. It does **not** render PDFs.
- The **designed** exports are built **client-side in Flutter** from a single `ReportTable` model (`core/report_export.dart`), so CSV and PDF share one self-describing layout. PDF via the `pdf`/`printing` packages; CSV via `share_plus`. Delivery is a browser download on web and a share sheet on mobile.
- **Money model in the reports:** GNN LLC's own income (usage fee + commission) is kept in its own columns/totals; the drivers' gross fares are shown separately and labelled as the drivers' turnover, **not** GNN income (see ADR 0003). The driver-facing earnings export is the driver's own record for their own taxes.
- **Unicode (amended 2026-10-27):** bundle regular/bold Roboto and its license in `assets/fonts/`, then embed those fonts in the PDF. Runtime font downloads failed during maintenance tests; silently falling back to Helvetica could corrupt names. Missing fonts now fail visibly. Both weights have tested coverage of Turkish letters and typographic dashes. CSV remains UTF-8-BOM'd and formula-injection-guarded.
- **Letterhead is a seam:** `ReportOrg` carries the org name and defaults to the real NH Taxi logo. Address and tax number remain user-owned optional fields.

## Consequences
- No PDF/accounting dependency ever enters the Worker; the API stays lean and within free-tier limits.
- Export correctness is unit-testable as pure functions (`buildReportCsv`, `buildReportPdf`, the table builders), but the actual `share_plus` web-download click path is not covered by tests and wants one manual confirmation.
- Already-fetched report data can be exported without contacting a font service.

## Evidence
- `apps/mobile/lib/core/report_export.dart`, `core/report_tables.dart`, `widgets/report_export_sheet.dart`
- `apps/api/src/routes/admin.ts` (`financial-summary`, `driver-earnings`, `?format=csv`), `lib/csv.ts`
- `.memory-bank/changelog/verified-worklog.md` → "Money reporting"
