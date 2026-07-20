import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/models/directory_driver.dart';
import 'package:gnncab/models/fare_estimate.dart';
import 'package:gnncab/models/trip.dart';

void main() {
  group('Trip', () {
    Map<String, dynamic> tripJson({
      String status = 'REQUESTED',
      String? dropoffAddress = 'Elm St',
      num? estimatedFare = 7.61,
      num? finalFare,
    }) =>
        {
          'id': 't1',
          'status': status,
          'pickupAddress': 'Main St',
          'dropoffAddress': dropoffAddress,
          'distanceMiles': 4.26,
          'estimatedFare': estimatedFare,
          'finalFare': finalFare,
          'currency': 'USD',
          'requestedAt': '2026-07-19T12:00:00.000Z',
          'completedAt': null,
        };

    test('parses the wire shape', () {
      final trip = Trip.fromJson(tripJson());
      expect(trip.id, 't1');
      expect(trip.pickupAddress, 'Main St');
      expect(trip.distanceMiles, 4.26);
      expect(trip.currency, 'USD');
    });

    test('tolerates a null dropoff (admin-assigned trip before pickup)', () {
      final trip = Trip.fromJson(tripJson(dropoffAddress: null));
      expect(trip.dropoffAddress, isNull);
    });

    test('displayFare prefers the final fare once it exists', () {
      expect(Trip.fromJson(tripJson()).displayFare, 7.61);
      expect(Trip.fromJson(tripJson(finalFare: 8.20)).displayFare, 8.20);
    });

    test('isActive covers exactly the non-terminal states', () {
      for (final status in ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_EN_ROUTE', 'TRIP_STARTED']) {
        expect(Trip.fromJson(tripJson(status: status)).isActive, isTrue, reason: status);
      }
      for (final status in ['TRIP_COMPLETED', 'TRIP_CANCELLED', 'TIMEOUT']) {
        expect(Trip.fromJson(tripJson(status: status)).isActive, isFalse, reason: status);
      }
    });

    test('isSearching covers the states where dispatch is still hunting', () {
      for (final status in ['REQUESTED', 'DRIVER_REJECTED', 'DRIVER_NO_RESPONSE']) {
        expect(Trip.fromJson(tripJson(status: status)).isSearching, isTrue, reason: status);
      }
      // A driver is on it, or it's over — either way, no more searching.
      for (final status in ['DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'TRIP_STARTED', 'TIMEOUT', 'TRIP_COMPLETED']) {
        expect(Trip.fromJson(tripJson(status: status)).isSearching, isFalse, reason: status);
      }
    });

    test('a timed-out trip can be retried and closed, but not a finished one', () {
      final timedOut = Trip.fromJson(tripJson(status: 'TIMEOUT'));
      expect(timedOut.canRetrySearch, isTrue);
      // The bug this guards: TIMEOUT used to be uncancellable, leaving the
      // trip stuck in the passenger's list with no way out.
      expect(timedOut.canCancel, isTrue);

      for (final status in ['TRIP_STARTED', 'TRIP_COMPLETED', 'TRIP_CANCELLED']) {
        expect(Trip.fromJson(tripJson(status: status)).canCancel, isFalse, reason: status);
      }
      expect(Trip.fromJson(tripJson(status: 'REQUESTED')).canCancel, isTrue);
    });

    test('cancelling stays open until the driver actually sets off', () {
      // Accepting is just a tap — the passenger can still change their mind.
      for (final status in ['REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED']) {
        final trip = Trip.fromJson(tripJson(status: status));
        expect(trip.canCancel, isTrue, reason: status);
        expect(trip.mustCallToCancel, isFalse, reason: status);
      }
      // From here the driver is moving, so it's a phone call. These must mirror
      // CUSTOMER_NON_CANCELLABLE in routes/trips.ts or the app offers a button
      // the API will refuse.
      for (final status in ['DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'TRIP_STARTED']) {
        final trip = Trip.fromJson(tripJson(status: status));
        expect(trip.canCancel, isFalse, reason: status);
        expect(trip.mustCallToCancel, isTrue, reason: status);
      }
      // Already over — nothing to cancel and nobody to call about it.
      for (final status in ['TRIP_COMPLETED', 'TRIP_CANCELLED']) {
        final trip = Trip.fromJson(tripJson(status: status));
        expect(trip.canCancel, isFalse, reason: status);
        expect(trip.mustCallToCancel, isFalse, reason: status);
      }
    });

    test('parses the search-progress fields the countdown renders from', () {
      final trip = Trip.fromJson({
        ...tripJson(),
        'searchAttempts': 3,
        'nextSearchAt': '2026-07-19T12:01:00.000Z',
        'maxSearchAttempts': 15,
      });
      expect(trip.searchAttempts, 3);
      expect(trip.maxSearchAttempts, 15);
      expect(trip.nextSearchAt, DateTime.parse('2026-07-19T12:01:00.000Z'));
    });

    test('every backend status maps to a human label', () {
      const allStatuses = [
        'REQUESTED', 'DRIVER_ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_REJECTED',
        'DRIVER_EN_ROUTE', 'DRIVER_ARRIVED', 'TRIP_STARTED', 'TRIP_COMPLETED',
        'TRIP_CANCELLED', 'DRIVER_NO_RESPONSE', 'TIMEOUT',
      ];
      for (final status in allStatuses) {
        final label = Trip.fromJson(tripJson(status: status)).statusLabel;
        // A raw enum name leaking to the UI means we forgot to map one.
        expect(label, isNot(equals(status)), reason: status);
      }
    });
  });

  group('DirectoryDriver', () {
    Map<String, dynamic> driverJson({String status = 'AVAILABLE', Object? freeInMinutes}) => {
          'driverId': 'd1',
          'firstName': 'Dan',
          'status': status,
          'lat': 44.05,
          'lng': -71.12,
          'distanceMiles': 1.4,
          'phone': '+16035550101',
          'vehicleMake': 'Toyota',
          'vehicleModel': 'Sienna',
          'vehicleColor': 'Silver',
          'vehiclePlate': 'NH-1234',
          'photoUrl': null,
          'freeInMinutes': freeInMinutes,
        };

    test('parses the wire shape and builds a map point', () {
      final d = DirectoryDriver.fromJson(driverJson());
      expect(d.driverId, 'd1');
      expect(d.isAvailable, isTrue);
      expect(d.vehiclePlate, 'NH-1234');
      expect(d.point!.latitude, 44.05);
    });

    test('drops a driver off the map when the server has no position', () {
      final d = DirectoryDriver.fromJson({...driverJson(), 'lat': null, 'lng': null});
      expect(d.point, isNull);
    });

    test('describes the vehicle from whatever the driver has filled in', () {
      expect(DirectoryDriver.fromJson(driverJson()).vehicleDescription, 'Silver Toyota Sienna');

      final sparse = DirectoryDriver.fromJson({...driverJson(), 'vehicleColor': null, 'vehicleMake': null});
      expect(sparse.vehicleDescription, 'Sienna');

      final none = DirectoryDriver.fromJson(
        {...driverJson(), 'vehicleColor': null, 'vehicleMake': null, 'vehicleModel': null},
      );
      expect(none.vehicleDescription, isNull);
    });

    test('only claims a free-in time when the server worked one out', () {
      // The whole point of the null: a made-up ETA would have a passenger
      // waiting on a driver who isn't coming.
      final unknown = DirectoryDriver.fromJson(driverJson(status: 'BUSY'));
      expect(unknown.availabilityDetail, 'On a trip');

      final known = DirectoryDriver.fromJson(driverJson(status: 'BUSY', freeInMinutes: 20));
      expect(known.availabilityDetail, contains('20'));
    });
  });

  test('FareEstimate parses the quote endpoint response', () {
    final estimate = FareEstimate.fromJson({
      'distanceMiles': 4.26,
      'estimatedFare': 7.61,
      'currency': 'USD',
    });
    expect(estimate.distanceMiles, 4.26);
    expect(estimate.estimatedFare, 7.61);
    expect(estimate.currency, 'USD');
  });
}
