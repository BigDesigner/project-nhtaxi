import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import '../../models/trip.dart';

/// True while a background refresh is in flight, so the list can stay on
/// screen instead of being replaced by a spinner.
class TripsRefreshing extends Notifier<bool> {
  @override
  bool build() => false;

  // ignore: use_setters_to_change_properties
  void set(bool value) => state = value;
}

final tripsRefreshingProvider = NotifierProvider<TripsRefreshing, bool>(TripsRefreshing.new);

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

  /// Re-reads the list, keeping the current one on screen while it loads.
  ///
  /// Deliberately does not push an AsyncLoading state: blanking the list to a
  /// spinner on every return from the trip screen made the app feel like it
  /// was losing data. The "busy" flag lives in [tripsRefreshingProvider] so
  /// the UI can show a thin progress bar over the still-visible rows.
  Future<void> refresh() async {
    ref.read(tripsRefreshingProvider.notifier).set(true);
    try {
      final trips = await _fetch();
      state = AsyncData(trips);
      _syncPolling(trips);
    } on ApiException catch (e) {
      // Only surface the error if we have nothing to show; otherwise the
      // stale-but-real list beats an error page.
      if (!state.hasValue) state = AsyncError(e, StackTrace.current);
    } finally {
      ref.read(tripsRefreshingProvider.notifier).set(false);
    }
  }
}

final tripsControllerProvider = AsyncNotifierProvider<TripsController, List<Trip>>(TripsController.new);
