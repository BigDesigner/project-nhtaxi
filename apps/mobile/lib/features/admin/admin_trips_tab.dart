import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/fare_range.dart';
import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

/// Live jobs first, history underneath, and the button for a phoned-in
/// booking.
///
/// A trip nobody picked up is the one thing the office genuinely has to act
/// on, so those are called out rather than left to be spotted in a list.
class AdminTripsTab extends ConsumerWidget {
  const AdminTripsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(adminTripsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(adminTripsProvider);
        await ref.read(adminTripsProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
                child: Icon(Icons.add_call, color: Theme.of(context).colorScheme.primary),
              ),
              title: const Text('Phoned-in booking'),
              subtitle: const Text('Assign a job straight to a driver'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => context.go('/home/assign'),
            ),
          ),
          const SizedBox(height: 24),
          switch (trips) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _TripSections(trips: value),
          },
        ],
      ),
    );
  }
}

class _TripSections extends StatelessWidget {
  const _TripSections({required this.trips});

  final List<AdminTripRow> trips;

  @override
  Widget build(BuildContext context) {
    if (trips.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: Text('No trips yet.')),
      );
    }

    final stuck = trips.where((t) => t.needsAttention).toList();
    final live = trips.where((t) => t.isLive && !t.needsAttention).toList();
    final done = trips.where((t) => !t.isLive).toList();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        if (stuck.isNotEmpty) ...[
          Text('Needs attention', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'No driver took these. Call the passenger, or assign someone directly.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          for (final t in stuck) _TripCard(trip: t, accent: Colors.red),
          const SizedBox(height: 24),
        ],
        if (live.isNotEmpty) ...[
          Text('In progress', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          for (final t in live) _TripCard(trip: t, accent: Colors.blue),
          const SizedBox(height: 24),
        ],
        Text('Finished', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (done.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('None yet.'))
        else
          for (final t in done) _TripCard(trip: t, accent: null),
      ],
    );
  }
}

class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip, required this.accent});

  final AdminTripRow trip;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Icon(Icons.local_taxi, color: accent),
        title: Text(trip.customerName),
        subtitle: Text(
          [
            trip.driverName ?? 'No driver yet',
            trip.status.toLowerCase().replaceAll('_', ' '),
            _formatDate(trip.requestedAt),
          ].join(' · '),
          style: Theme.of(context).textTheme.bodySmall,
        ),
        trailing: trip.displayFare == null
            ? null
            : Text(formatFare(trip.displayFare!, currency: trip.currency)),
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
