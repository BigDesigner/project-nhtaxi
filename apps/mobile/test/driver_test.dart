import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/models/driver_billing.dart';
import 'package:nhtaxi/models/driver_profile.dart';
import 'package:nhtaxi/models/trip.dart';

Map<String, dynamic> profileJson({String status = 'AVAILABLE', Object? plate = 'NH-1234'}) => {
      'id': 'dp1',
      'userId': 'u1',
      'email': 'dan@example.com',
      'firstName': 'Dan',
      'lastName': 'Driver',
      'phone': '+16035550101',
      'status': status,
      'isVerified': true,
      'totalTrips': 12,
      'vehicleMake': 'Toyota',
      'vehicleModel': 'Sienna',
      'vehicleColor': 'Silver',
      'vehiclePlate': plate,
      'vehicleYear': 2019,
    };

Map<String, dynamic> tripJson({
  String status = 'DRIVER_ASSIGNED',
  String origin = 'CUSTOMER_APP',
  Object? commissionPercent,
  Object? estimatedFare = 100.0,
  Object? finalFare,
}) =>
    {
      'id': 't1',
      'status': status,
      'origin': origin,
      'commissionPercent': commissionPercent,
      'pickupAddress': 'Main St',
      'dropoffAddress': 'Logan Airport',
      'distanceMiles': 138.0,
      'estimatedFare': estimatedFare,
      'finalFare': finalFare,
      'currency': 'USD',
      'requestedAt': '2026-07-20T12:00:00.000Z',
      'completedAt': null,
    };

void main() {
  group('DriverProfile', () {
    test('parses the wire shape', () {
      final p = DriverProfile.fromJson(profileJson());
      expect(p.fullName, 'Dan Driver');
      expect(p.vehicleDescription, 'Silver Toyota Sienna');
      expect(p.totalTrips, 12);
    });

    test('separates being online from being free for a job', () {
      // The distinction the toggle depends on: BUSY is still online and still
      // billable, but the driver cannot be handed another trip and must not
      // be allowed to go offline mid-job.
      final busy = DriverProfile.fromJson(profileJson(status: 'BUSY'));
      expect(busy.isOnline, isTrue);
      expect(busy.isAvailable, isFalse);
      expect(busy.isOnJob, isTrue);

      final free = DriverProfile.fromJson(profileJson(status: 'AVAILABLE'));
      expect(free.isOnline, isTrue);
      expect(free.isAvailable, isTrue);
      expect(free.isOnJob, isFalse);

      final off = DriverProfile.fromJson(profileJson(status: 'OFFLINE'));
      expect(off.isOnline, isFalse);
      expect(off.isOnJob, isFalse);
    });

    test('knows when the car details are too thin to show a passenger', () {
      expect(DriverProfile.fromJson(profileJson()).hasCompleteVehicle, isTrue);
      // No plate means a passenger cannot identify the car at the kerb, which
      // is the whole point of showing it on the driver map.
      expect(DriverProfile.fromJson(profileJson(plate: null)).hasCompleteVehicle, isFalse);
    });
  });

  group('Trip commission', () {
    test('an ordinary trip owes nothing and the driver keeps the fare', () {
      final t = Trip.fromJson(tripJson());
      expect(t.commissionPercent, isNull);
      expect(t.commissionOwed, isNull);
      expect(t.driverTakeHome, 100.0);
    });

    test('an office-assigned trip splits the fare', () {
      final t = Trip.fromJson(
        tripJson(origin: 'ADMIN_ASSIGNED', commissionPercent: 20, estimatedFare: 300.0),
      );
      expect(t.commissionOwed, 60.0);
      expect(t.driverTakeHome, 240.0);
    });

    test('the split follows the final fare once the job is done', () {
      // What the driver is charged has to track what was actually collected,
      // not the quote — otherwise the commission is wrong on every trip whose
      // fare moved.
      final t = Trip.fromJson(
        tripJson(
          status: 'TRIP_COMPLETED',
          origin: 'ADMIN_ASSIGNED',
          commissionPercent: 20,
          estimatedFare: 300.0,
          finalFare: 330.0,
        ),
      );
      expect(t.commissionOwed, closeTo(66.0, 0.001));
      expect(t.driverTakeHome, closeTo(264.0, 0.001));
    });

    test('parses the coordinates the job screen navigates to', () {
      final t = Trip.fromJson({...tripJson(), 'pickupLat': 44.05, 'pickupLng': -71.12});
      expect(t.pickupLat, 44.05);
      expect(t.pickupLng, -71.12);
    });
  });

  group('DriverBalance', () {
    test('breaks the debt down by where it came from', () {
      final b = DriverBalance.fromJson({
        'usageFeeCharged': 45.0,
        'commissionCharged': 60.0,
        'totalCharged': 105.0,
        'totalCollected': 40.0,
        'pendingBalance': 65.0,
        'hasOpenSession': true,
      });
      expect(b.usageFeeCharged, 45.0);
      expect(b.commissionCharged, 60.0);
      expect(b.pendingBalance, 65.0);
      expect(b.hasOpenSession, isTrue);
    });

    test('defaults to zero rather than throwing on a driver with no history', () {
      final b = DriverBalance.fromJson(const {});
      expect(b.pendingBalance, 0);
      expect(b.hasOpenSession, isFalse);
    });
  });

  group('DriverSession', () {
    test('an open session has no end or charge yet', () {
      final s = DriverSession.fromJson({
        'id': 's1',
        'driverId': 'dp1',
        'startedAt': '2026-07-20T08:00:00.000Z',
        'endedAt': null,
        'durationMinutes': null,
        'charge': null,
        'closedReason': null,
      });
      expect(s.isOpen, isTrue);
      expect(s.wasTimedOut, isFalse);
    });

    test('flags a session the server closed on its own', () {
      // This one still cost the driver money, so the UI has to be able to say
      // why it appeared — otherwise it reads as an unexplained charge.
      final s = DriverSession.fromJson({
        'id': 's2',
        'driverId': 'dp1',
        'startedAt': '2026-07-20T08:00:00.000Z',
        'endedAt': '2026-07-20T10:00:00.000Z',
        'durationMinutes': 120,
        'charge': 30.0,
        'closedReason': 'STALE_TIMEOUT',
      });
      expect(s.isOpen, isFalse);
      expect(s.wasTimedOut, isTrue);
      expect(s.closedReasonLabel, contains('automatically'));
      expect(s.charge, 30.0);
    });
  });
}
