import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/models/admin.dart';

void main() {
  group('AdminDriver', () {
    Map<String, dynamic> json({bool isVerified = true, String status = 'AVAILABLE'}) => {
          'id': 'dp1',
          'userId': 'u1',
          'email': 'dan@example.com',
          'firstName': 'Dan',
          'lastName': 'Driver',
          'phone': '+16035550101',
          'vehicleMake': 'Toyota',
          'vehicleModel': 'Sienna',
          'vehiclePlate': 'NH-1234',
          'status': status,
          'isVerified': isVerified,
          'totalTrips': 7,
        };

    test('parses the wire shape', () {
      final d = AdminDriver.fromJson(json());
      expect(d.fullName, 'Dan Driver');
      expect(d.vehicleDescription, 'Toyota Sienna · NH-1234');
      expect(d.totalTrips, 7);
    });

    test('treats anything but OFFLINE as being on shift', () {
      expect(AdminDriver.fromJson(json(status: 'BUSY')).isOnline, isTrue);
      expect(AdminDriver.fromJson(json(status: 'OFFLINE')).isOnline, isFalse);
    });

    test('copes with a driver who has not filled in a vehicle', () {
      final d = AdminDriver.fromJson({
        ...json(),
        'vehicleMake': null,
        'vehicleModel': null,
        'vehiclePlate': null,
      });
      expect(d.vehicleDescription, isNull);
    });
  });

  group('AdminTripRow', () {
    Map<String, dynamic> json({String status = 'TRIP_COMPLETED', Object? finalFare = 120.0}) => {
          'tripId': 't1',
          'status': status,
          'requestedAt': '2026-07-20T12:00:00.000Z',
          'completedAt': null,
          'driverId': 'dp1',
          'driverName': 'Dan Driver',
          'customerId': 'c1',
          'customerName': 'Pat Passenger',
          'distanceMiles': 12.0,
          'estimatedFare': 100.0,
          'finalFare': finalFare,
          'currency': 'USD',
          'paymentMethod': 'cash',
        };

    test('prefers the charged fare over the quote', () {
      expect(AdminTripRow.fromJson(json()).displayFare, 120.0);
      expect(AdminTripRow.fromJson(json(finalFare: null)).displayFare, 100.0);
    });

    test('separates live trips from finished ones', () {
      expect(AdminTripRow.fromJson(json(status: 'TRIP_STARTED')).isLive, isTrue);
      for (final s in ['TRIP_COMPLETED', 'TRIP_CANCELLED', 'TIMEOUT']) {
        expect(AdminTripRow.fromJson(json(status: s)).isLive, isFalse, reason: s);
      }
    });

    test('flags the trips nobody picked up', () {
      // These are the only rows the office actually has to act on, so they
      // get pulled to the top of the monitor rather than sorted in by date.
      expect(AdminTripRow.fromJson(json(status: 'TIMEOUT')).needsAttention, isTrue);
      expect(AdminTripRow.fromJson(json(status: 'DRIVER_NO_RESPONSE')).needsAttention, isTrue);
      expect(AdminTripRow.fromJson(json(status: 'TRIP_STARTED')).needsAttention, isFalse);
    });

    test('falls back to Guest for a phoned-in booking with no account', () {
      final row = AdminTripRow.fromJson({...json(), 'customerName': null});
      expect(row.customerName, 'Guest');
    });
  });

  group('PricingConfig', () {
    test('keeps the fare and the driver-billing rates apart', () {
      // Two independent businesses share this row: what a passenger pays, and
      // what a driver owes GNN LLC. Mixing them up would misprice both.
      final p = PricingConfig.fromJson({
        'id': 'p1',
        'cityId': null,
        'baseFare': 2.5,
        'perMile': 1.2,
        'driverUsagePerMinute': 0.25,
        'driverCommissionPercent': 20,
        'currency': 'USD',
        'updatedAt': '2026-07-20T12:00:00.000Z',
      });
      expect(p.baseFare, 2.5);
      expect(p.perMile, 1.2);
      expect(p.driverUsagePerMinute, 0.25);
      expect(p.driverCommissionPercent, 20);
    });
  });

  group('DriverBalanceRow', () {
    test('parses a driver who owes nothing yet', () {
      final r = DriverBalanceRow.fromJson({'driverId': 'dp1'});
      expect(r.driverName, 'Unknown');
      expect(r.pendingBalance, 0);
      expect(r.hasOpenSession, isFalse);
    });
  });

  group('CashCollection', () {
    test('parses a recorded hand-over', () {
      final c = CashCollection.fromJson({
        'id': 'cc1',
        'driverId': 'dp1',
        'driverName': 'Dan Driver',
        'amount': 45.5,
        'collectedAt': '2026-07-20T12:00:00.000Z',
        'collectedByName': 'Office',
        'notes': 'Two weeks',
        'createdAt': '2026-07-20T12:00:00.000Z',
      });
      expect(c.amount, 45.5);
      expect(c.notes, 'Two weeks');
    });
  });
}
