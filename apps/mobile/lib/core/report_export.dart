import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:pdf/pdf.dart';
import 'package:pdf/widgets.dart' as pw;
import 'package:printing/printing.dart';
import 'package:share_plus/share_plus.dart';

/// The organisation a report is filed under. Only the name is filled today —
/// address, tax number and a logo are left as a deliberate seam so they can be
/// dropped in later without touching any call site or the renderers.
class ReportOrg {
  const ReportOrg({this.name = 'GNN LLC', this.address, this.taxId, this.logo});

  final String name;
  final String? address;
  final String? taxId;

  /// A PNG/JPEG the PDF header can show once we have one. Left null for now.
  final Uint8List? logo;

  static const ReportOrg gnn = ReportOrg();
}

/// One column: its header text, a one-line explanation of what it means (shown
/// in the report's legend), and whether it holds a number (right-aligned in the
/// PDF, and summed into the totals row by the caller).
class ReportColumn {
  const ReportColumn(this.header, {this.description = '', this.numeric = false});

  final String header;
  final String description;
  final bool numeric;
}

/// A fully-described table ready to render to CSV or PDF. Cells are
/// pre-formatted strings so the two renderers stay identical — money is
/// formatted by the caller (via formatFare) before it ever gets here.
class ReportTable {
  ReportTable({
    required this.title,
    required this.columns,
    required this.rows,
    this.org = ReportOrg.gnn,
    this.from,
    this.to,
    this.totals,
    this.notes = const [],
    DateTime? generatedAt,
  }) : generatedAt = generatedAt ?? DateTime.now();

  /// What the report is, e.g. "Financial summary" or "Driver balances".
  final String title;
  final ReportOrg org;
  final List<ReportColumn> columns;

  /// Data rows, each the same length as [columns].
  final List<List<String>> rows;

  /// Optional bold summing row (same length as [columns]); leave a cell empty
  /// where a total makes no sense.
  final List<String>? totals;

  /// The period the figures cover. Null bounds read as open-ended.
  final DateTime? from;
  final DateTime? to;

  /// Extra explanatory lines printed under the table (the money model, caveats).
  final List<String> notes;

  final DateTime generatedAt;

  String get periodLabel {
    String d(DateTime? x) => x == null ? '…' : _isoDate(x);
    if (from == null && to == null) return 'All time';
    return '${d(from)} – ${d(to)}';
  }
}

String _isoDate(DateTime dt) {
  final d = dt.toLocal();
  return '${d.year.toString().padLeft(4, '0')}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
}

String _stamp(DateTime dt) {
  final d = dt.toLocal();
  final hh = d.hour.toString().padLeft(2, '0');
  final mm = d.minute.toString().padLeft(2, '0');
  return '${_isoDate(dt)} $hh:$mm';
}

// ─── CSV ────────────────────────────────────────────────────────────────────
// Same OWASP formula-injection guard as the backend's lib/csv.ts: a cell that
// opens with one of these is coerced to text so a spreadsheet won't run it.
const _formulaPrefixes = ['=', '+', '-', '@', '\t', '\r'];

String _csvCell(String value) {
  var cell = value;
  if (cell.isNotEmpty && _formulaPrefixes.any(cell.startsWith)) {
    cell = "'$cell";
  }
  if (RegExp(r'[",\n\r]').hasMatch(cell)) {
    cell = '"${cell.replaceAll('"', '""')}"';
  }
  return cell;
}

String _csvRow(List<String> cells) => cells.map(_csvCell).join(',');

/// Builds the report as a CSV string, headed by a small metadata block (org,
/// title, period, generated-at), then the column headers, the rows, the totals
/// row, and finally a legend explaining every column and the notes. Pure — no
/// I/O — so it can be asserted on directly in tests.
String buildReportCsv(ReportTable t) {
  final lines = <String>[
    _csvRow([t.org.name]),
    if (t.org.address != null) _csvRow([t.org.address!]),
    if (t.org.taxId != null) _csvRow(['Tax no', t.org.taxId!]),
    _csvRow([t.title]),
    _csvRow(['Period', t.periodLabel]),
    _csvRow(['Generated', _stamp(t.generatedAt)]),
    '',
    _csvRow(t.columns.map((c) => c.header).toList()),
  ];
  for (final row in t.rows) {
    lines.add(_csvRow(row));
  }
  if (t.totals != null) lines.add(_csvRow(t.totals!));

  final legend = t.columns.where((c) => c.description.isNotEmpty).toList();
  if (legend.isNotEmpty || t.notes.isNotEmpty) {
    lines.add('');
    lines.add(_csvRow(['Notes']));
    for (final c in legend) {
      lines.add(_csvRow(['${c.header}: ${c.description}']));
    }
    for (final n in t.notes) {
      lines.add(_csvRow([n]));
    }
  }
  return lines.join('\r\n');
}

// ─── PDF ────────────────────────────────────────────────────────────────────
/// Builds a print-ready PDF: an org/title/period header band, the table with a
/// shaded header row, zebra body rows, right-aligned numeric columns and a bold
/// totals row, then a legend + notes block. Returns the raw bytes so the same
/// document can be shared, downloaded or asserted on in a test.
Future<Uint8List> buildReportPdf(ReportTable t) async {
  final doc = pw.Document();
  final numeric = t.columns.map((c) => c.numeric).toList();

  pw.Widget cell(String text, {required bool isNumeric, bool bold = false}) => pw.Padding(
        padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 4),
        child: pw.Text(
          text,
          textAlign: isNumeric ? pw.TextAlign.right : pw.TextAlign.left,
          style: pw.TextStyle(fontSize: 9, fontWeight: bold ? pw.FontWeight.bold : pw.FontWeight.normal),
        ),
      );

  final headerRow = pw.TableRow(
    decoration: const pw.BoxDecoration(color: PdfColors.blueGrey800),
    children: [
      for (var i = 0; i < t.columns.length; i++)
        pw.Padding(
          padding: const pw.EdgeInsets.symmetric(horizontal: 6, vertical: 5),
          child: pw.Text(
            t.columns[i].header,
            textAlign: numeric[i] ? pw.TextAlign.right : pw.TextAlign.left,
            style: pw.TextStyle(fontSize: 9, fontWeight: pw.FontWeight.bold, color: PdfColors.white),
          ),
        ),
    ],
  );

  final bodyRows = <pw.TableRow>[];
  for (var r = 0; r < t.rows.length; r++) {
    bodyRows.add(pw.TableRow(
      decoration: pw.BoxDecoration(color: r.isEven ? PdfColors.white : PdfColors.grey100),
      children: [
        for (var i = 0; i < t.columns.length; i++)
          cell(r < t.rows.length && i < t.rows[r].length ? t.rows[r][i] : '', isNumeric: numeric[i]),
      ],
    ));
  }
  if (t.totals != null) {
    bodyRows.add(pw.TableRow(
      decoration: const pw.BoxDecoration(
        color: PdfColors.blueGrey50,
        border: pw.Border(top: pw.BorderSide(color: PdfColors.blueGrey400, width: 1)),
      ),
      children: [
        for (var i = 0; i < t.columns.length; i++)
          cell(i < t.totals!.length ? t.totals![i] : '', isNumeric: numeric[i], bold: true),
      ],
    ));
  }

  doc.addPage(
    pw.MultiPage(
      pageFormat: PdfPageFormat.a4,
      margin: const pw.EdgeInsets.all(28),
      build: (context) => [
        pw.Row(
          mainAxisAlignment: pw.MainAxisAlignment.spaceBetween,
          crossAxisAlignment: pw.CrossAxisAlignment.start,
          children: [
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.start,
              children: [
                pw.Text(t.org.name, style: pw.TextStyle(fontSize: 16, fontWeight: pw.FontWeight.bold)),
                if (t.org.address != null) pw.Text(t.org.address!, style: const pw.TextStyle(fontSize: 9)),
                if (t.org.taxId != null) pw.Text('Tax no: ${t.org.taxId}', style: const pw.TextStyle(fontSize: 9)),
              ],
            ),
            pw.Column(
              crossAxisAlignment: pw.CrossAxisAlignment.end,
              children: [
                pw.Text(t.title, style: pw.TextStyle(fontSize: 13, fontWeight: pw.FontWeight.bold)),
                pw.Text('Period: ${t.periodLabel}', style: const pw.TextStyle(fontSize: 9)),
                pw.Text('Generated: ${_stamp(t.generatedAt)}', style: const pw.TextStyle(fontSize: 9)),
              ],
            ),
          ],
        ),
        pw.SizedBox(height: 14),
        pw.Table(
          border: pw.TableBorder.all(color: PdfColors.grey300, width: 0.5),
          children: [headerRow, ...bodyRows],
        ),
        if (t.columns.any((c) => c.description.isNotEmpty) || t.notes.isNotEmpty) ...[
          pw.SizedBox(height: 16),
          pw.Text('Notes', style: pw.TextStyle(fontSize: 10, fontWeight: pw.FontWeight.bold)),
          pw.SizedBox(height: 4),
          for (final c in t.columns.where((c) => c.description.isNotEmpty))
            pw.Bullet(text: '${c.header}: ${c.description}', style: const pw.TextStyle(fontSize: 8)),
          for (final n in t.notes) pw.Bullet(text: n, style: const pw.TextStyle(fontSize: 8)),
        ],
      ],
    ),
  );

  return doc.save();
}

// ─── Delivery ────────────────────────────────────────────────────────────────
/// A short filesystem-safe slug for the download filename.
String _slug(String title) =>
    title.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-').replaceAll(RegExp(r'(^-|-$)'), '');

String reportFilename(ReportTable t, String ext) => '${_slug(t.title)}-${_isoDate(t.generatedAt)}.$ext';

/// Hands the finished PDF to the platform: a browser download on web, the share
/// sheet on mobile. [Printing] handles both without any platform branches here.
Future<void> sharePdfReport(ReportTable t) async {
  final bytes = await buildReportPdf(t);
  await Printing.sharePdf(bytes: bytes, filename: reportFilename(t, 'pdf'));
}

/// Hands the finished CSV to the platform (browser download on web, share sheet
/// on mobile) via share_plus.
Future<void> shareCsvReport(ReportTable t) async {
  final bytes = Uint8List.fromList(utf8Bom(buildReportCsv(t)));
  await SharePlus.instance.share(
    ShareParams(
      files: [XFile.fromData(bytes, name: reportFilename(t, 'csv'), mimeType: 'text/csv')],
      fileNameOverrides: [reportFilename(t, 'csv')],
    ),
  );
}

/// A UTF-8 BOM in front of the UTF-8 bytes so Excel reads accented names right.
List<int> utf8Bom(String s) => [0xEF, 0xBB, 0xBF, ...utf8.encode(s)];
