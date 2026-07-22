import '../models/admin.dart';
import '../models/driver_billing.dart';
import 'fare_range.dart';
import 'report_export.dart';

/// Turns the money models into fully-described [ReportTable]s — one place that
/// owns the column headers, their explanations, and the totals row, so the CSV
/// and PDF exports (and the admin/driver screens) all agree on what a report
/// says. Pure functions: no I/O, no widgets, easy to assert on.

String _d(DateTime? dt) {
  if (dt == null) return '';
  final d = dt.toLocal();
  final dd = d.day.toString().padLeft(2, '0');
  final mm = d.month.toString().padLeft(2, '0');
  return '$dd.$mm.${d.year}';
}

double _sum<T>(List<T> xs, double Function(T) pick) => xs.fold(0, (s, x) => s + pick(x));

/// The tax-filing backbone: GNN's income (rent + commission) with cash
/// collected, plus the drivers' own gross fares kept clearly separate.
ReportTable financialSummaryTable(FinancialSummary s, {DateTime? from, DateTime? to}) {
  String m(double v) => formatFare(v, currency: s.currency);
  return ReportTable(
    title: 'Financial summary',
    from: from,
    to: to,
    columns: const [
      ReportColumn('Driver'),
      ReportColumn('App usage fee', description: "GNN's rent for time on the app (per online minute).", numeric: true),
      ReportColumn('Commission', description: 'GNN commission on office-referred jobs only.', numeric: true),
      ReportColumn('GNN revenue', description: "GNN's income from this driver: usage fee + commission.", numeric: true),
      ReportColumn('Cash collected', description: 'Cash the office recorded receiving from the driver.', numeric: true),
      ReportColumn('Trips', description: 'Completed trips in the period.', numeric: true),
      ReportColumn('Gross fares', description: "The driver's own turnover (passenger-paid) — NOT GNN income.", numeric: true),
    ],
    rows: [
      for (final d in s.drivers)
        [
          d.driverName,
          m(d.usageFeesCharged),
          m(d.commissionCharged),
          m(d.gnnRevenue),
          m(d.cashCollected),
          '${d.completedTripCount}',
          m(d.grossFares),
        ],
    ],
    totals: [
      'TOTAL',
      m(s.usageFeesCharged),
      m(s.commissionCharged),
      m(s.gnnGrossRevenue),
      m(s.cashCollected),
      '${s.completedTripCount}',
      m(s.grossFares),
    ],
    notes: const [
      "GNN LLC's taxable income is the usage fee (rent) plus commission — the 'GNN revenue' column.",
      "Gross fares are the money passengers paid the drivers directly; that turnover is the drivers' own, not GNN's, and is shown only for reference.",
    ],
  );
}

/// What every driver still owes GNN, and how it breaks down.
ReportTable driverBalancesTable(List<DriverBalanceRow> rows) {
  String m(double v) => formatFare(v);
  return ReportTable(
    title: 'Driver balances',
    columns: const [
      ReportColumn('Driver'),
      ReportColumn('Usage fee', description: 'Charged for time on the app.', numeric: true),
      ReportColumn('Commission', description: 'Charged on office-referred jobs.', numeric: true),
      ReportColumn('Total charged', description: 'Usage fee + commission.', numeric: true),
      ReportColumn('Collected', description: 'Cash the office has recorded receiving.', numeric: true),
      ReportColumn('Pending', description: 'Still owed: charged minus collected.', numeric: true),
      ReportColumn('Online'),
    ],
    rows: [
      for (final r in rows)
        [
          r.driverName,
          m(r.usageFeeCharged),
          m(r.commissionCharged),
          m(r.totalCharged),
          m(r.totalCollected),
          m(r.pendingBalance),
          r.hasOpenSession ? 'yes' : '',
        ],
    ],
    totals: [
      'TOTAL',
      m(_sum(rows, (r) => r.usageFeeCharged)),
      m(_sum(rows, (r) => r.commissionCharged)),
      m(_sum(rows, (r) => r.totalCharged)),
      m(_sum(rows, (r) => r.totalCollected)),
      m(_sum(rows, (r) => r.pendingBalance)),
      '',
    ],
  );
}

/// Every commission charge, so a disputed balance figure can be traced to a job.
ReportTable commissionsTable(List<CommissionCharge> rows) {
  String m(double v) => formatFare(v);
  return ReportTable(
    title: 'Commission charges',
    columns: const [
      ReportColumn('Date'),
      ReportColumn('Driver'),
      ReportColumn('Trip'),
      ReportColumn('Fare', description: 'The fare the commission was taken from.', numeric: true),
      ReportColumn('Rate %', description: 'Commission percentage applied.', numeric: true),
      ReportColumn('Commission', description: 'Amount owed to GNN on this job.', numeric: true),
    ],
    rows: [
      for (final r in rows)
        [
          _d(r.createdAt),
          r.driverName,
          r.tripId,
          m(r.fare),
          r.commissionPercent.toStringAsFixed(0),
          m(r.commission),
        ],
    ],
    totals: ['TOTAL', '', '', '', '', m(_sum(rows, (r) => r.commission))],
    notes: const ['Commission is charged only on jobs GNN LLC referred — ordinary dispatch work carries none.'],
  );
}

/// Every cash hand-over the office recorded.
ReportTable collectionsTable(List<CashCollection> rows) {
  String m(double v) => formatFare(v);
  return ReportTable(
    title: 'Cash collections',
    columns: const [
      ReportColumn('Date'),
      ReportColumn('Driver'),
      ReportColumn('Amount', description: 'Cash received from the driver.', numeric: true),
      ReportColumn('Taken by'),
      ReportColumn('Notes'),
    ],
    rows: [
      for (final r in rows)
        [_d(r.collectedAt), r.driverName, m(r.amount), r.collectedByName, r.notes ?? ''],
    ],
    totals: ['TOTAL', '', m(_sum(rows, (r) => r.amount)), '', ''],
  );
}

/// Per-driver completed-fare totals — the fleet at a glance, or one driver.
ReportTable adminDriverEarningsTable(List<AdminDriverEarningsRow> rows, {DateTime? from, DateTime? to}) {
  final currency = rows.isEmpty ? 'USD' : rows.first.currency;
  String m(double v) => formatFare(v, currency: currency);
  return ReportTable(
    title: 'Driver earnings',
    from: from,
    to: to,
    columns: const [
      ReportColumn('Driver'),
      ReportColumn('Trips', description: 'Completed trips in the period.', numeric: true),
      ReportColumn('Earnings', description: "The driver's turnover — total fares passengers paid them.", numeric: true),
    ],
    rows: [
      for (final r in rows) [r.driverName, '${r.tripCount}', m(r.totalEarnings)],
    ],
    totals: [
      'TOTAL',
      '${rows.fold<int>(0, (s, r) => s + r.tripCount)}',
      m(_sum(rows, (r) => r.totalEarnings)),
    ],
    notes: const ["These fares are the drivers' own income (paid in cash by passengers), for their own tax records."],
  );
}

/// A single driver's own completed trips and total — their tax record.
ReportTable driverOwnEarningsTable(DriverEarnings e, {required String driverName, DateTime? from, DateTime? to}) {
  String m(double? v) => v == null ? '' : formatFare(v, currency: e.currency);
  return ReportTable(
    title: 'My earnings — $driverName',
    from: from,
    to: to,
    columns: const [
      ReportColumn('Date'),
      ReportColumn('Trip'),
      ReportColumn('Distance (mi)', numeric: true),
      ReportColumn('Fare', description: 'Cash the passenger paid you for this trip.', numeric: true),
    ],
    rows: [
      for (final t in e.trips)
        [_d(t.completedAt), t.tripId, t.distanceMiles?.toStringAsFixed(1) ?? '', m(t.fare)],
    ],
    totals: ['TOTAL', '${e.tripCount} trips', '', m(e.totalEarnings)],
    notes: const ['This is a record of cash paid to you directly by passengers — not a payment made through the app.'],
  );
}
