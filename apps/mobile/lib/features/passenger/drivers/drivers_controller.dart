import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/providers.dart';
import '../../../models/directory_driver.dart';

/// The fleet, for the "choose a driver" map.
///
/// Not polled: a passenger browsing the list is looking at a snapshot and can
/// pull to refresh. Live marker movement is Wave 3's WebSocket job — polling
/// every driver's position on a timer would cost far more than it's worth.
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
