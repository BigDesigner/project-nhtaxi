import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/trip.dart';
import '../../widgets/error_banner.dart';
import 'passenger_home_screen.dart' show TripTile;
import 'trips_controller.dart';

/// Every trip, past and present.
///
/// The home screen shows only what's happening now; finished and cancelled
/// trips were crowding it out. This is where they live instead — grouped, so
/// a passenger looking for a receipt isn't scrolling past cancellations.
class PassengerTripsTab extends ConsumerWidget {
  const PassengerTripsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(tripsControllerProvider);

    return RefreshIndicator(
      onRefresh: () => ref.read(tripsControllerProvider.notifier).refresh(),
      child: switch (trips) {
        AsyncLoading() when !trips.hasValue => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) when !trips.hasValue => ListView(
            padding: const EdgeInsets.all(16),
            children: [ErrorBanner(message: error.toString())],
          ),
        AsyncValue(:final value?) => _Sections(trips: value),
        _ => const SizedBox.shrink(),
      },
    );
  }
}

class _Sections extends StatelessWidget {
  const _Sections({required this.trips});

  final List<Trip> trips;

  @override
  Widget build(BuildContext context) {
    if (trips.isEmpty) {
      return ListView(
        children: [
          Padding(
            padding: const EdgeInsets.all(48),
            child: Column(
              children: [
                Icon(Icons.map_outlined, size: 48, color: Theme.of(context).disabledColor),
                const SizedBox(height: 12),
                Text('No trips yet', style: Theme.of(context).textTheme.bodyMedium),
              ],
            ),
          ),
        ],
      );
    }

    final live = trips.where((t) => t.needsAttentionOnHome).toList();
    final completed = trips.where((t) => t.status == 'TRIP_COMPLETED').toList();
    // Everything else: cancelled, and searches that were given up on.
    final closed =
        trips.where((t) => !t.needsAttentionOnHome && t.status != 'TRIP_COMPLETED').toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (live.isNotEmpty) ...[
          _Heading(text: 'In progress', count: live.length),
          for (final t in live) TripTile(trip: t),
          const SizedBox(height: 16),
        ],
        if (completed.isNotEmpty) ...[
          _Heading(text: 'Completed', count: completed.length),
          for (final t in completed) TripTile(trip: t),
          const SizedBox(height: 16),
        ],
        if (closed.isNotEmpty) ...[
          _Heading(text: 'Cancelled', count: closed.length),
          for (final t in closed) TripTile(trip: t),
        ],
      ],
    );
  }
}

class _Heading extends StatelessWidget {
  const _Heading({required this.text, required this.count});

  final String text;
  final int count;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Text('$text ($count)', style: Theme.of(context).textTheme.titleMedium),
    );
  }
}
