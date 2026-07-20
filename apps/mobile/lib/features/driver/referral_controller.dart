import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/location_service.dart';
import '../../core/providers.dart';
import '../../core/trip_path_recorder.dart';
import '../../models/trip.dart';
import 'driver_controllers.dart';

/// Raised when the phone cannot say where it is.
///
/// This flow has no fallback — the coordinates *are* the trip record. A
/// referral job opened without them would be a job with no pickup, and a fare
/// with nothing to compute it from, which is the exact thing this whole
/// feature exists to avoid.
class NoLocationException implements Exception {
  NoLocationException(this.message);
  final String message;
  @override
  String toString() => message;
}

/// The Referral button.
///
/// The office rang the driver — "someone's waiting outside the Eastern Slope
/// Inn". There is no booking, no passenger account and nothing typed in. The
/// driver taps once as the passenger gets in, and once as they get out, and
/// the phone supplies both positions.
///
/// The alternative was a "log a manual job" form at the end of a shift. It was
/// rejected because it asks a tired driver to recall a route and name a price,
/// and GNN LLC's commission on the job would then rest on that recollection.
/// Capturing both ends live means the fare is computed from the same routed
/// road distance as every other trip on the platform.
class ReferralController {
  ReferralController(this._ref);

  final Ref _ref;

  Future<LatLng> _here() async {
    final result = await _ref.read(locationServiceProvider).current();
    final point = result.point;
    if (point == null) {
      throw NoLocationException(
        result.failure == null
            ? 'Could not get your location.'
            : LocationService.messageFor(result.failure!),
      );
    }
    return point;
  }

  /// Best-effort street name for a position.
  ///
  /// Deliberately never throws: the address is a human convenience, the
  /// coordinates are the record. A geocoder that is slow or down must not be
  /// able to stop a driver starting a job — the server falls back to the
  /// coordinates itself.
  Future<String?> _describe(LatLng point) async {
    try {
      return await _ref.read(geocodingProvider).reverse(point);
    } catch (_) {
      return null;
    }
  }

  /// Opens the trip at the kerb, already in progress.
  Future<Trip> start({String? guestName, String? guestPhone}) async {
    final here = await _here();
    final address = await _describe(here);

    final json = await _ref.read(apiClientProvider).post(
      '/api/referral-trips',
      body: {
        'lat': here.latitude,
        'lng': here.longitude,
        'address': ?address,
        'guestName': ?guestName,
        'guestPhone': ?guestPhone,
      },
    );
    final trip = Trip.fromJson(json);

    // From here until dropoff, the app records where the car goes.
    _ref.read(tripPathRecorderProvider).start(trip.id);
    await _ref.read(driverTripsProvider.notifier).refresh();
    _ref.invalidate(driverProfileProvider);
    return trip;
  }

  /// Closes the trip where the passenger got out, and prices it.
  Future<Trip> complete(String tripId) async {
    final here = await _here();
    final address = await _describe(here);

    // Stopped *before* the completion call so the last points are already in
    // when the office looks at the trip — and so a 400 from the now-closed
    // path can't be mistaken for a failed dropoff.
    await _ref.read(tripPathRecorderProvider).stop();

    final json = await _ref.read(apiClientProvider).post(
      '/api/referral-trips/$tripId/complete',
      body: {'lat': here.latitude, 'lng': here.longitude, 'address': ?address},
    );

    await _ref.read(driverTripsProvider.notifier).refresh();
    _ref.invalidate(driverProfileProvider);
    // The commission on a referred job lands on the driver's balance here.
    _ref.invalidate(driverBalanceProvider);
    return Trip.fromJson(json);
  }
}

final referralControllerProvider = Provider<ReferralController>(ReferralController.new);
