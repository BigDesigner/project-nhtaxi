import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../models/trip.dart';
import '../../widgets/error_banner.dart';
import '../auth/auth_controller.dart';
import 'trips_controller.dart';

class PassengerHomeScreen extends ConsumerWidget {
  const PassengerHomeScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    final trips = ref.watch(tripsControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('GNNcab'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
          ),
        ],
      ),
      body: RefreshIndicator(
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
            const SizedBox(height: 24),
            Text('Your trips', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            switch (trips) {
              AsyncLoading() => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 32),
                  child: Center(child: CircularProgressIndicator()),
                ),
              AsyncError(:final error) => ErrorBanner(message: error.toString()),
              AsyncValue(:final value?) when value.isEmpty => const _EmptyTrips(),
              AsyncValue(:final value?) => Column(
                  children: [for (final trip in value) _TripTile(trip: trip)],
                ),
            },
          ],
        ),
      ),
    );
  }
}

/// Booking lands in Wave 2 (map + address search + fare preview). Shown as a
/// visibly disabled affordance rather than hidden, so the shape of the app is
/// already clear.
class _RequestTripCard extends StatelessWidget {
  const _RequestTripCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        leading: const Icon(Icons.local_taxi),
        title: const Text('Request a trip'),
        subtitle: const Text('Map and booking arrive in the next update'),
        trailing: const Icon(Icons.chevron_right),
        enabled: false,
        onTap: null,
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
      child: ListTile(
        leading: Icon(trip.isActive ? Icons.directions_car : Icons.check_circle_outline),
        title: Text(trip.dropoffAddress ?? trip.pickupAddress),
        subtitle: Text('${trip.statusLabel} · ${_formatDate(trip.requestedAt)}'),
        trailing: fare == null ? null : Text('\$${fare.toStringAsFixed(2)}'),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final local = dt.toLocal();
    final d = local.day.toString().padLeft(2, '0');
    final m = local.month.toString().padLeft(2, '0');
    return '$d.$m.${local.year}';
  }
}
