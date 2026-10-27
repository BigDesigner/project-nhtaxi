import 'dart:convert';

import 'package:flutter/services.dart' show rootBundle;
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/report_export.dart';
import 'package:nhtaxi/core/report_tables.dart';
import 'package:nhtaxi/core/trip_id.dart';
import 'package:nhtaxi/models/admin.dart';
import 'package:nhtaxi/models/driver_billing.dart';
import 'package:pdf/pdf.dart' show TtfParser;

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  group('buildReportCsv', () {
    final table = ReportTable(
      title: 'Test report',
      from: DateTime.utc(2026, 1, 1),
      to: DateTime.utc(2026, 1, 31, 23, 59, 59),
      generatedAt: DateTime.utc(2026, 2, 1, 9, 30),
      columns: const [
        ReportColumn('Driver'),
        ReportColumn('Amount', description: 'Money owed', numeric: true),
      ],
      rows: const [
        ['Dan Driver', r'$12.00'],
        ['Sam Wheel', r'$8.50'],
      ],
      totals: const ['TOTAL', r'$20.50'],
      notes: const ['A note.'],
    );

    test('carries the header block, column headers, rows, totals and legend', () {
      final csv = buildReportCsv(table);
      expect(csv, contains('GNN LLC'));
      expect(csv, contains('Test report'));
      expect(csv, contains('Period'));
      expect(csv, contains('Generated'));
      expect(csv, contains('Driver,Amount'));
      expect(csv, contains('Dan Driver'));
      expect(csv, contains('TOTAL'));
      // Column legend + free-form note.
      expect(csv, contains('Amount: Money owed'));
      expect(csv, contains('A note.'));
    });

    test('neutralises spreadsheet formula injection', () {
      final t = ReportTable(
        title: 'x',
        columns: const [ReportColumn('Name')],
        rows: const [
          ['=SUM(A1:A2)'],
        ],
      );
      final line = buildReportCsv(t).split('\r\n').firstWhere((l) => l.contains('SUM'));
      // A leading = would run as a formula; it must be quoted-out as text.
      expect(line.startsWith("'=") || line.startsWith('"\'='), isTrue, reason: line);
    });

    test('period label reads open-ended when no dates are set', () {
      final t = ReportTable(title: 'x', columns: const [ReportColumn('A')], rows: const []);
      expect(t.periodLabel, 'All time');
    });
  });

  group('buildReportPdf', () {
    test('produces a non-empty PDF document', () async {
      final table = ReportTable(
        title: 'PDF report',
        columns: const [ReportColumn('A'), ReportColumn('B', numeric: true)],
        rows: const [
          ['Çağrı Şahin – İpek Öztürk', '1'],
          ['two', '2'],
        ],
        totals: const ['TOTAL', '3'],
      );
      final bytes = await buildReportPdf(table);
      expect(bytes.length, greaterThan(0));
      // Every PDF starts with the "%PDF" magic bytes.
      expect(String.fromCharCodes(bytes.take(4)), '%PDF');
    });

    test('both bundled PDF fonts cover Turkish names and punctuation', () async {
      for (final weight in ['Regular', 'Bold']) {
        final data = await rootBundle.load('assets/fonts/Roboto-$weight.ttf');
        final font = TtfParser(data);
        for (final rune in 'ÇĞİÖŞÜçğıöşü–—'.runes) {
          expect(font.charToGlyphIndexMap[rune], greaterThan(0),
              reason: '$weight must support ${String.fromCharCode(rune)}');
        }
      }
    });

    testWidgets('the default PDF logo asset actually resolves', (tester) async {
      final data = await rootBundle.load('assets/branding/logo-pdf.png');
      expect(data.lengthInBytes, greaterThan(0));
    });
  });

  group('shortTripId', () {
    test('takes the first 8 characters of a UUID', () {
      expect(shortTripId('5662e069-1a23-4d52-b7e4-ca829ad03465'), '5662e069');
    });
    test('leaves a shorter string untouched', () {
      expect(shortTripId('abc'), 'abc');
    });
  });

  group('driverOwnEarningsTable', () {
    test('shows short IDs, passenger and route, not the raw UUID', () {
      final earnings = DriverEarnings(
        tripCount: 1,
        totalEarnings: 12.5,
        currency: 'USD',
        trips: [
          EarnedTrip(
            tripId: '5662e069-1a23-4d52-b7e4-ca829ad03465',
            currency: 'USD',
            completedAt: DateTime.utc(2026, 7, 21),
            customerName: 'Mustafa Gonen',
            pickupAddress: 'Main St',
            dropoffAddress: 'Mountain Rd',
            fare: 12.5,
          ),
        ],
      );
      final table = driverOwnEarningsTable(earnings, driverName: 'Dan Driver');
      expect(table.columns.map((c) => c.header), containsAll(['Passenger', 'Route']));
      final row = table.rows.single;
      expect(row, contains('5662e069'));
      expect(row.every((cell) => !cell.contains('ca829ad03465')), isTrue);
      expect(row, contains('Mustafa Gonen'));
      expect(row.any((cell) => cell.contains('Main St') && cell.contains('Mountain Rd')), isTrue);
    });
  });

  group('tripFareReportTable', () {
    TripReportRow trip({
      required String id,
      required String status,
      required bool referred,
      double? finalFare,
      double? estimatedFare,
    }) =>
        TripReportRow(
          tripId: id,
          status: status,
          requestedAt: DateTime.utc(2026, 7, 20),
          completedAt: status == 'TRIP_COMPLETED' ? DateTime.utc(2026, 7, 20, 1) : null,
          customerName: 'Pat Passenger',
          driverName: 'Dan Driver',
          finalFare: finalFare,
          estimatedFare: estimatedFare,
          currency: 'USD',
          referred: referred,
        );

    test('only sums completed trips into TOTAL, excluding cancelled/other', () {
      final rows = [
        trip(id: 'aaaaaaaa-0000-0000-0000-000000000000', status: 'TRIP_COMPLETED', referred: false, finalFare: 10),
        trip(id: 'bbbbbbbb-0000-0000-0000-000000000000', status: 'TRIP_CANCELLED', referred: false, estimatedFare: 50),
        trip(id: 'cccccccc-0000-0000-0000-000000000000', status: 'TIMEOUT', referred: false, estimatedFare: 20),
      ];
      final table = tripFareReportTable(rows);

      // All three trips are still listed...
      expect(table.rows, hasLength(3));
      // ...but only the completed one's fare reaches TOTAL.
      final fareCol = table.columns.indexWhere((c) => c.header == 'Fare');
      expect(table.totals![fareCol], r'$10.00');
      expect(table.totals!.first, contains('completed only'));
    });

    test('shows Status for every row and never marks a non-completed trip Referred', () {
      final rows = [
        // Referral was set on the trip, but it was cancelled before finishing —
        // no commission was ever actually charged (trips.ts only inserts it at
        // TRIP_COMPLETED), so this must NOT read "Y".
        trip(id: 'dddddddd-0000-0000-0000-000000000000', status: 'TRIP_CANCELLED', referred: true, estimatedFare: 30),
        trip(id: 'eeeeeeee-0000-0000-0000-000000000000', status: 'TRIP_COMPLETED', referred: true, finalFare: 12),
      ];
      final table = tripFareReportTable(rows);

      final statusCol = table.columns.indexWhere((c) => c.header == 'Status');
      final referredCol = table.columns.indexWhere((c) => c.header == 'Referred');
      expect(table.rows[0][statusCol], 'Cancelled');
      expect(table.rows[0][referredCol], isEmpty);
      expect(table.rows[1][statusCol], 'Completed');
      expect(table.rows[1][referredCol], 'Y');
    });

    test('notes the excluded not-completed trips when there are any', () {
      final rows = [
        trip(id: 'ffffffff-0000-0000-0000-000000000000', status: 'TRIP_CANCELLED', referred: false, estimatedFare: 15),
      ];
      final table = tripFareReportTable(rows);
      expect(table.notes.any((n) => n.contains('1 trip(s)') && n.contains('not part of TOTAL')), isTrue);
    });
  });

  group('financialSummaryTable', () {
    test('lays out GNN income and gross fares with a totals row', () {
      final summary = FinancialSummary(
        from: DateTime.utc(2026, 1, 1),
        to: DateTime.utc(2026, 1, 31),
        currency: 'USD',
        usageFeesCharged: 30,
        commissionCharged: 20,
        gnnGrossRevenue: 50,
        cashCollected: 40,
        completedTripCount: 5,
        grossFares: 200,
        drivers: const [
          FinancialSummaryRow(
            driverId: 'd1',
            driverName: 'Dan Driver',
            usageFeesCharged: 30,
            commissionCharged: 20,
            gnnRevenue: 50,
            cashCollected: 40,
            completedTripCount: 5,
            grossFares: 200,
          ),
        ],
      );

      final table = financialSummaryTable(summary, from: summary.from, to: summary.to);
      expect(table.columns.map((c) => c.header), containsAll(['GNN revenue', 'Gross fares']));
      expect(table.rows.single.first, 'Dan Driver');
      expect(table.totals!.first, 'TOTAL');
      // GNN revenue total is rent + commission = 50.
      final gnnCol = table.columns.indexWhere((c) => c.header == 'GNN revenue');
      expect(table.totals![gnnCol], r'$50.00');

      // The CSV of it round-trips the driver and the total.
      final csv = utf8.decode(utf8Bom(buildReportCsv(table)).skip(3).toList());
      expect(csv, contains('Dan Driver'));
      expect(csv, contains(r'$50.00'));
    });
  });
}
