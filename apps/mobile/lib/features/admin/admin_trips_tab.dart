import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../models/admin.dart';
import '../../models/trip.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/trip_id_row.dart';
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
          const _TripLookupCard(),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: Theme.of(context).colorScheme.primary.withValues(alpha: 0.15),
                child: Icon(Icons.add_call, color: Theme.of(context).colorScheme.primary),
              ),
              title: const Text('Assign a job to a driver'),
              subtitle: const Text('For a booking taken over the phone · earns commission'),
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

/// Look up any trip by its ID or the short 8-char code a passenger/driver reads
/// out. Prefix search, so the short code is enough; results show the full trip.
class _TripLookupCard extends ConsumerStatefulWidget {
  const _TripLookupCard();

  @override
  ConsumerState<_TripLookupCard> createState() => _TripLookupCardState();
}

class _TripLookupCardState extends ConsumerState<_TripLookupCard> {
  final _controller = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _search() {
    setState(() => _query = _controller.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    final results = _query.isEmpty ? null : ref.watch(adminTripLookupProvider(_query));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.search),
                const SizedBox(width: 8),
                Text('Find a trip by ID', style: Theme.of(context).textTheme.titleMedium),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              'Paste a full trip ID or the short code a passenger or driver gave you.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _controller,
                    textInputAction: TextInputAction.search,
                    onSubmitted: (_) => _search(),
                    decoration: const InputDecoration(
                      hintText: 'e.g. 5662e069',
                      border: OutlineInputBorder(),
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 8),
                FilledButton(onPressed: _search, child: const Text('Search')),
              ],
            ),
            if (results != null) ...[
              const SizedBox(height: 12),
              switch (results) {
                AsyncLoading() => const Center(child: Padding(padding: EdgeInsets.all(8), child: CircularProgressIndicator())),
                AsyncError(:final error) => ErrorBanner(message: error.toString()),
                AsyncData(:final value) when value.isEmpty => Text(
                    'No trip found for "$_query".',
                    style: Theme.of(context).textTheme.bodyMedium,
                  ),
                AsyncData(:final value) => Column(
                    children: [for (final t in value) _TripLookupResult(trip: t)],
                  ),
              },
            ],
          ],
        ),
      ),
    );
  }
}

/// One matched trip: who, where, when, how much, and its copyable ID.
class _TripLookupResult extends StatelessWidget {
  const _TripLookupResult({required this.trip});

  final Trip trip;

  @override
  Widget build(BuildContext context) {
    final route = trip.dropoffAddress == null
        ? trip.pickupAddress
        : '${trip.pickupAddress}\n→ ${trip.dropoffAddress}';
    return Card(
      margin: const EdgeInsets.only(top: 8),
      color: Theme.of(context).colorScheme.surfaceContainerHighest,
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(trip.statusLabel, style: Theme.of(context).textTheme.titleSmall)),
                if (trip.displayFare != null)
                  Text(formatFare(trip.displayFare!, currency: trip.currency),
                      style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 4),
            Text('Passenger: ${trip.customerName ?? 'Unknown'}', style: Theme.of(context).textTheme.bodySmall),
            Text('Driver: ${trip.driverName ?? 'Unassigned'}', style: Theme.of(context).textTheme.bodySmall),
            Text(route, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 6),
            TripIdRow(tripId: trip.id),
          ],
        ),
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

class _TripCard extends ConsumerStatefulWidget {
  const _TripCard({required this.trip, required this.accent});

  final AdminTripRow trip;
  final Color? accent;

  @override
  ConsumerState<_TripCard> createState() => _TripCardState();
}

class _TripCardState extends ConsumerState<_TripCard> {
  bool _busy = false;

  Future<void> _toggleReferral() async {
    setState(() => _busy = true);
    try {
      await setTripReferral(ref, widget.trip.tripId, !widget.trip.isReferred);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _reassign() async {
    final drivers = await ref.read(adminDriversProvider.future);
    // Only approved drivers can be given work at all, so offering the rest
    // would just produce a rejection from the API.
    final eligible = drivers.where((d) => d.isVerified).toList();
    if (!mounted) return;

    if (eligible.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No approved drivers to give this to.')),
      );
      return;
    }

    final driverId = await showModalBottomSheet<String>(
      context: context,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          children: [
            const Padding(
              padding: EdgeInsets.all(16),
              child: Text('Give this job to'),
            ),
            for (final d in eligible)
              ListTile(
                title: Text(d.fullName),
                subtitle: Text(
                  [d.status.toLowerCase(), if (d.vehicleDescription != null) d.vehicleDescription!].join(' · '),
                ),
                onTap: () => Navigator.pop(context, d.id),
              ),
          ],
        ),
      ),
    );
    if (driverId == null) return;

    setState(() => _busy = true);
    try {
      await reassignTrip(ref, widget.trip.tripId, driverId);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    // Commission is settled the moment a trip completes, so the flag stops
    // being editable there — see the API, which refuses it too.
    final canChange = trip.status != 'TRIP_COMPLETED';

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        children: [
          ListTile(
            leading: Icon(Icons.local_taxi, color: widget.accent),
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
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
            child: Row(
              children: [
                Icon(
                  trip.isReferred ? Icons.handshake : Icons.handshake_outlined,
                  size: 16,
                  color: trip.isReferred ? Colors.green : Theme.of(context).disabledColor,
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    trip.isReferred ? 'Referred by GNN LLC — commission applies' : 'No commission',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ),
                if (_busy)
                  const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
                else ...[
                  // The "needs attention" heading tells the office to assign
                  // someone directly; this is the button that does it.
                  if (trip.needsAttention)
                    TextButton(onPressed: _reassign, child: const Text('Give to a driver')),
                  if (canChange)
                    TextButton(
                      onPressed: _toggleReferral,
                      child: Text(trip.isReferred ? 'Not referred' : 'Mark referred'),
                    ),
                  // The route is what settles "the driver took the long way
                  // round". Only worth offering once the car has actually
                  // moved — before pickup there is nothing recorded.
                  IconButton(
                    tooltip: 'See the route',
                    icon: const Icon(Icons.route_outlined, size: 20),
                    onPressed: () => context.go('/home/trip-path/${trip.tripId}'),
                  ),
                ],
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 4),
            child: TripIdRow(tripId: trip.tripId),
          ),
        ],
      ),
    );
  }

  String _formatDate(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
