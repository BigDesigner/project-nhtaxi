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
- **Unicode:** the PDF's built-in Helvetica has no Unicode, so Turkish names and typographic punctuation box out. Roboto is embedded via `PdfGoogleFonts` (fetched once, cached; falls back to the built-in font rather than failing an export). Report *text* is additionally kept to plain ASCII punctuation so it's clean even on the fallback font. CSV is UTF-8-BOM'd for Excel and OWASP formula-injection-guarded.
- **Letterhead is a seam:** `ReportOrg` carries the org name (filled) and address/tax-number/logo (null for now, to be supplied by the user).

## Consequences
- No PDF/accounting dependency ever enters the Worker; the API stays lean and within free-tier limits.
- Export correctness is unit-testable as pure functions (`buildReportCsv`, `buildReportPdf`, the table builders), but the actual `share_plus` web-download click path is not covered by tests and wants one manual confirmation.
- Because generation is client-side, an export always has connectivity (the data itself came over the network), so the runtime font fetch adds no new offline limitation.

## Evidence
- `apps/mobile/lib/core/report_export.dart`, `core/report_tables.dart`, `widgets/report_export_sheet.dart`
- `apps/api/src/routes/admin.ts` (`financial-summary`, `driver-earnings`, `?format=csv`), `lib/csv.ts`
- `.memory-bank/changelog/verified-worklog.md` → "Money reporting"
