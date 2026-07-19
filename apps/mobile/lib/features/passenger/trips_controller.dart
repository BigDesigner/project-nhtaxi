import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import '../../models/trip.dart';

/// The signed-in passenger's own trips, newest first (the API already orders
/// them that way — see routes/trips.ts).
class TripsController extends AsyncNotifier<List<Trip>> {
  Timer? _timer;

  /// Only polls while something is actually being searched for, and stops the
  /// moment nothing is — an idle passenger's list costs zero requests.
  static const _pollInterval = Duration(seconds: 10);

  @override
  Future<List<Trip>> build() async {
    ref.onDispose(() => _timer?.cancel());
    final trips = await _fetch();
    _syncPolling(trips);
    return trips;
  }

  Future<List<Trip>> _fetch() async {
    final raw = await ref.read(apiClientProvider).getList('/api/trips');
    return raw.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
  }

  void _syncPolling(List<Trip> trips) {
    final needsPolling = trips.any((t) => t.isSearching);
    if (needsPolling) {
      _timer ??= Timer.periodic(_pollInterval, (_) => _poll());
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  Future<void> _poll() async {
    try {
      final trips = await _fetch();
      state = AsyncData(trips);
      _syncPolling(trips);
    } on ApiException {
      // Transient failure — keep the last good list and retry next tick.
    }
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final trips = await _fetch();
      _syncPolling(trips);
      return trips;
    });
  }
}

final tripsControllerProvider = AsyncNotifierProvider<TripsController, List<Trip>>(TripsController.new);
