import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/trip.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/search_countdown.dart';
import '../auth/auth_controller.dart';
import 'trips_controller.dart';

class PassengerHomeTab extends ConsumerWidget {
  const PassengerHomeTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    final trips = ref.watch(tripsControllerProvider);
    final refreshing = ref.watch(tripsRefreshingProvider);

    return Stack(
      children: [
        RefreshIndicator(
          onRefresh: () => ref.read(tripsControllerProvider.notifier).refresh(),
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (user != null) ...[
                Text('Hi ${user.firstName}', style: Theme.of(context).textTheme.headlineSmall),
                const SizedBox(height: 4),
                Text(user.email, style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 24),
              ],
              const _RequestTripCard(),
              const SizedBox(height: 8),
              const _BrowseDriversCard(),
              const SizedBox(height: 24),
              Text('Your trips', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              switch (trips) {
                // Only a cold load blanks the list; a refresh keeps the old
                // rows and shows the bar below instead.
                AsyncLoading() when !trips.hasValue => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                AsyncError(:final error) when !trips.hasValue => ErrorBanner(message: error.toString()),
                AsyncValue(:final value?) when value.isEmpty => const _EmptyTrips(),
                AsyncValue(:final value?) => Column(
                    children: [for (final trip in value) _TripTile(trip: trip)],
                  ),
                _ => const SizedBox.shrink(),
              },
            ],
          ),
        ),
        // Refresh-in-progress hint that doesn't take the content away.
        if (refreshing && trips.hasValue)
          const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 2)),
      ],
    );
  }
}

class _RequestTripCard extends StatelessWidget {
  const _RequestTripCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.local_taxi),
        title: const Text('Request a trip'),
        subtitle: const Text('Pick your pickup and destination'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.go('/book'),
      ),
    );
  }
}

class _BrowseDriversCard extends StatelessWidget {
  const _BrowseDriversCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.people_outline),
        title: const Text('See our drivers'),
        subtitle: const Text('Find someone nearby and ask for them by name'),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.go('/drivers'),
      ),
    );
  }
}

class _EmptyTrips extends StatelessWidget {
  const _EmptyTrips();

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 32),
      child: Column(
        children: [
          Icon(Icons.map_outlined, size: 48, color: Theme.of(context).disabledColor),
          const SizedBox(height: 12),
          Text('No trips yet', style: Theme.of(context).textTheme.bodyMedium),
        ],
      ),
    );
  }
}

class _TripTile extends StatelessWidget {
  const _TripTile({required this.trip});

  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final fare = trip.displayFare;
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        children: [
          ListTile(
            // Colour carries the state at a glance: blue = we're working on
            // it, green = a driver is on it or it's done, red = it isn't
            // happening.
            leading: Icon(_statusIcon(trip), color: _statusColor(trip)),
            title: Text(trip.dropoffAddress ?? trip.pickupAddress),
            subtitle: Text('${trip.statusLabel} · ${_formatDate(trip.requestedAt)}'),
            trailing: fare == null ? null : Text('\$${fare.toStringAsFixed(2)}'),
            onTap: () => context.go('/trip/${trip.id}'),
          ),
          // The same countdown as the trip screen, so a passenger watching
          // the list can see the search is still running without opening it.
          if (trip.isSearching)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 12),
              child: Align(
                alignment: Alignment.centerLeft,
                child: SearchCountdown(trip: trip, compact: true),
              ),
            ),
        ],
      ),
    );
  }

  IconData _statusIcon(Trip trip) {
    if (trip.isSearching) return Icons.search;
    if (trip.isCancelled) return Icons.cancel;
    if (trip.canRetrySearch) return Icons.search_off;
    if (trip.status == 'TRIP_COMPLETED') return Icons.check_circle;
    return Icons.directions_car;
  }

  Color _statusColor(Trip trip) {
    if (trip.isSearching) return Colors.blue;
    if (trip.isCancelled || trip.canRetrySearch) return Colors.red;
    return Colors.green;
  }

  String _formatDate(DateTime dt) {
    final local = dt.toLocal();
    final d = local.day.toString().padLeft(2, '0');
    final m = local.month.toString().padLeft(2, '0');
    return '$d.$m.${local.year}';
  }
}
