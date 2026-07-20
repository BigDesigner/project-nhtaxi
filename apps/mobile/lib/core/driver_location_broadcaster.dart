import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'location_socket.dart';
import 'providers.dart';

/// Keeps the server's picture of where a driver is fresh for as long as they
/// are online — not only during a trip.
///
/// Nearest-driver dispatch (`apps/api/src/lib/dispatch.ts`) and the
/// passenger's "choose a driver" map both read
/// `driver_profiles.currentLat/currentLng`, and the *only* thing that ever
/// writes those columns is a `LOCATION_UPDATE` sent over this socket
/// (`apps/api/src/durable-objects/location-hub.ts`). Before this class
/// existed, no client ever sent one: a driver's position stayed null the
/// moment their real session outlived whatever a test had seeded by hand in
/// the database directly, and dispatch silently skips any driver whose
/// position is null. Going online without this running leaves that driver
/// invisible to both — not slow to find, unfindable.
class DriverLocationBroadcaster {
  DriverLocationBroadcaster(this._ref);

  final Ref _ref;

  /// Frequent enough that nearest-driver search and a passenger watching the
  /// map feel current; well under the 30-second cadence a trip in progress
  /// separately records as evidence (`core/trip_path_recorder.dart`). The two
  /// run independently on purpose — they serve different consumers with
  /// different retention, not one replacing the other.
  static const _interval = Duration(seconds: 10);

  Timer? _timer;

  bool get isRunning => _timer != null;

  void start() {
    if (_timer != null) return;
    _timer = Timer.periodic(_interval, (_) => _tick());
    unawaited(_tick());
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _tick() async {
    final result = await _ref.read(locationServiceProvider).current();
    final point = result.point;
    // A refused or momentarily unavailable fix isn't worth stopping over —
    // the next tick may well succeed, same reasoning as the path recorder.
    if (point == null) return;
    await _ref.read(locationSocketProvider).send({
      'type': 'LOCATION_UPDATE',
      'lat': point.latitude,
      'lng': point.longitude,
    });
  }
}

final driverLocationBroadcasterProvider = Provider<DriverLocationBroadcaster>((ref) {
  final broadcaster = DriverLocationBroadcaster(ref);
  ref.onDispose(broadcaster.stop);
  return broadcaster;
});
