import 'package:flutter/material.dart';

import '../core/report_export.dart';

/// Offers a finished [ReportTable] as a PDF or CSV download. The report is
/// already built by the time this opens, so both choices are instant. Errors
/// (a cancelled share, a platform hiccup) surface as a SnackBar rather than an
/// unhandled exception.
Future<void> showReportExportSheet(BuildContext context, ReportTable table) async {
  final messenger = ScaffoldMessenger.of(context);

  Future<void> run(Future<void> Function() action, String label) async {
    try {
      await action();
    } catch (e) {
      messenger.showSnackBar(SnackBar(content: Text('Could not export $label: $e')));
    }
  }

  await showModalBottomSheet<void>(
    context: context,
    builder: (ctx) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          ListTile(
            title: Text(table.title, style: Theme.of(ctx).textTheme.titleMedium),
            subtitle: Text(table.periodLabel),
          ),
          const Divider(height: 1),
          ListTile(
            leading: const Icon(Icons.picture_as_pdf_outlined),
            title: const Text('Download PDF'),
            subtitle: const Text('Formatted table with headers, totals and notes'),
            onTap: () async {
              Navigator.pop(ctx);
              await run(() => sharePdfReport(table), 'PDF');
            },
          ),
          ListTile(
            leading: const Icon(Icons.table_chart_outlined),
            title: const Text('Download CSV'),
            subtitle: const Text('Spreadsheet for accounting / tax tools'),
            onTap: () async {
              Navigator.pop(ctx);
              await run(() => shareCsvReport(table), 'CSV');
            },
          ),
        ],
      ),
    ),
  );
}
