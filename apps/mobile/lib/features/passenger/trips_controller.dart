import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/trip.dart';

/// The signed-in passenger's own trips, newest first (the API already orders
/// them that way — see routes/trips.ts).
class TripsController extends AsyncNotifier<List<Trip>> {
  @override
  Future<List<Trip>> build() async {
    final raw = await ref.read(apiClientProvider).getList('/api/trips');
    return raw.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(build);
  }
}

final tripsControllerProvider = AsyncNotifierProvider<TripsController, List<Trip>>(TripsController.new);
