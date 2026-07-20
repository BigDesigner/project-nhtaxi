import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/providers.dart';
import '../../../models/directory_driver.dart';

/// The fleet, for the "choose a driver" map.
///
/// Not polled, and deliberately not live either: a passenger browsing here
/// has no trip yet, and LocationHub only ever forwards a driver's position to
/// that driver's *matched* customer plus admins
/// (apps/api/src/durable-objects/location-hub.ts) — never to someone merely
/// looking at the fleet. Broadcasting every driver's live position to any
/// browsing passenger would be both wasteful and a real position leak for
/// drivers who haven't agreed to anyone-can-watch-me tracking. A snapshot
/// with pull-to-refresh is the right amount of freshness for "who's roughly
/// near me right now" — live movement is reserved for the active-trip screen
/// once there's an authorized relationship to hang it on.
class DriversController extends AsyncNotifier<List<DirectoryDriver>> {
  LatLng? _from;

  @override
  Future<List<DirectoryDriver>> build() => _fetch();

  Future<List<DirectoryDriver>> _fetch() async {
    // Sending our position lets the server sort nearest-first and fill in
    // distances; without it the list is still useful, just unsorted.
    final json = await ref.read(apiClientProvider).get(
          '/api/drivers',
          query: _from == null ? null : {'lat': _from!.latitude, 'lng': _from!.longitude},
        );
    final raw = (json['drivers'] as List<dynamic>?) ?? const [];
    return raw.map((e) => DirectoryDriver.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Re-reads the list from the passenger's position once we know it.
  Future<void> locate(LatLng from) async {
    _from = from;
    state = await AsyncValue.guard(_fetch);
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_fetch);
  }
}

final driversControllerProvider =
    AsyncNotifierProvider<DriversController, List<DirectoryDriver>>(DriversController.new);
