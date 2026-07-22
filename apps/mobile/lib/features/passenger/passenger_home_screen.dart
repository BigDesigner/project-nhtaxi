import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/fare_range.dart';
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
              // Only what's happening now. Finished and cancelled trips were
              // pushing the useful part of this screen off the bottom — they
              // live on the Trips tab instead.
              Text('Happening now', style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 8),
              switch (trips) {
                // Only a cold load blanks the list; a refresh keeps the old
                // rows and shows the bar below instead.
                AsyncLoading() when !trips.hasValue => const Padding(
                    padding: EdgeInsets.symmetric(vertical: 32),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                AsyncError(:final error) when !trips.hasValue => ErrorBanner(message: error.toString()),
                AsyncValue(:final value?) => switch (value.where((t) => t.needsAttentionOnHome).toList()) {
                    final live when live.isEmpty => const _EmptyTrips(),
                    final live => Column(children: [for (final trip in live) TripTile(trip: trip)]),
                  },
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

/// The two entry points on the home screen. Both carry a filled, tinted icon
/// rather than a bare outline — at a glance the cards were reading as plain
/// text rows, and the icon is what tells them apart.
class _ActionCard extends StatelessWidget {
  const _ActionCard({
    required this.icon,
    required this.color,
    required this.title,
    required this.subtitle,
    required this.destination,
  });

  final IconData icon;
  final Color color;
  final String title;
  final String subtitle;
  final String destination;

  @override
  Widget build(BuildContext context) {
    // A pale tint of the accent colour behind an icon of the *same* colour
    // reads as barely-there, worse on a bright screen — the circle is the
    // solid accent colour instead, with a foreground picked for contrast
    // against it (this card's colour varies by caller, e.g. the brand amber
    // needs black, a darker teal needs white).
    final foreground = ThemeData.estimateBrightnessForColor(color) == Brightness.dark ? Colors.white : Colors.black;
    return Card(
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: color,
          child: Icon(icon, color: foreground),
        ),
        title: Text(title, style: const TextStyle(fontWeight: FontWeight.w600)),
        subtitle: Text(subtitle),
        trailing: const Icon(Icons.chevron_right),
        onTap: () => context.go(destination),
      ),
    );
  }
}

class _RequestTripCard extends StatelessWidget {
  const _RequestTripCard();

  @override
  Widget build(BuildContext context) {
    return _ActionCard(
      icon: Icons.local_taxi,
      color: Theme.of(context).colorScheme.primary,
      title: 'Request a trip',
      subtitle: 'Pick your pickup and destination',
      destination: '/home/book',
    );
  }
}

class _BrowseDriversCard extends StatelessWidget {
  const _BrowseDriversCard();

  @override
  Widget build(BuildContext context) {
    return const _ActionCard(
      icon: Icons.groups,
      color: Colors.teal,
      title: 'See our drivers',
      subtitle: 'Find someone nearby and ask for them by name',
      destination: '/home/drivers',
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
          Text('Nothing in progress', style: Theme.of(context).textTheme.bodyMedium),
          const SizedBox(height: 4),
          Text('Past trips are on the Trips tab.', style: Theme.of(context).textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// An unfinished trip only ever has an estimate, so it shows a range; a
/// finished one shows the exact amount that was actually charged.
class _FareLabel extends StatelessWidget {
  const _FareLabel({required this.trip});

  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final fare = trip.displayFare;
    if (fare == null) return const SizedBox.shrink();

    final isFinal = trip.finalFare != null;
    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Text(
          formatFare(fare, currency: trip.currency),
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w600),
        ),
        Text(
          isFinal ? 'paid' : 'estimate',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Theme.of(context).hintColor),
        ),
      ],
    );
  }
}

/// One row in a trip list. Shared by the home screen and the Trips tab so the
/// same trip looks identical wherever it appears.
class TripTile extends StatelessWidget {
  const TripTile({super.key, required this.trip});

  final Trip trip;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        children: [
          ListTile(
            // Colour carries the state at a glance: blue = we're working on
            // it, green = a driver is on it or it's done, red = it isn't
            // happening.
            leading: Icon(_statusIcon(trip), color: _statusColor(trip)),
            title: Text(trip.destinationLabel, maxLines: 2, overflow: TextOverflow.ellipsis),
            subtitle: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              mainAxisSize: MainAxisSize.min,
              children: [
                Text('${trip.statusLabel} · ${_formatDate(trip.requestedAt)}'),
                // Who drove — so the passenger can see it in their history.
                if (trip.driverName != null)
                  Text('Driver: ${trip.driverName}', style: Theme.of(context).textTheme.bodySmall),
              ],
            ),
            isThreeLine: trip.driverName != null,
            // A quote stays a range right up until the trip is finished and
            // there's a real charged amount to show.
            trailing: _FareLabel(trip: trip),
            onTap: () => context.go('/home/trip/${trip.id}'),
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
