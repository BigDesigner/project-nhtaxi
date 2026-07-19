import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import '../../models/trip.dart';
import '../../widgets/error_banner.dart';

/// Polls one trip.
///
/// Polling is deliberate for this wave: it's a handful of requests over a
/// trip's lifetime, well inside the free tier, and it gets the screen working
/// without the WebSocket plumbing. Wave 3 swaps this for the LocationHub
/// socket, which also brings the driver's live position.
class TripController extends AsyncNotifier<Trip> {
  TripController(this.tripId);

  final String tripId;
  Timer? _timer;

  @override
  Future<Trip> build() async {
    _timer?.cancel();
    _timer = Timer.periodic(const Duration(seconds: 10), (_) => _poll());
    ref.onDispose(() => _timer?.cancel());
    return _fetch();
  }

  Future<Trip> _fetch() async {
    final json = await ref.read(apiClientProvider).get('/api/trips/$tripId');
    return Trip.fromJson(json);
  }

  Future<void> _poll() async {
    final current = state.value;
    // Nothing changes after a trip reaches a terminal state — stop polling.
    if (current != null && !current.isActive) {
      _timer?.cancel();
      return;
    }
    try {
      state = AsyncData(await _fetch());
    } on ApiException {
      // Transient failure: keep the last good state and try again next tick.
    }
  }

  Future<void> cancel(String reason) async {
    await ref.read(apiClientProvider).post('/api/trips/$tripId/cancel', body: {'reason': reason});
    state = AsyncData(await _fetch());
  }
}

final tripControllerProvider =
    AsyncNotifierProvider.family<TripController, Trip, String>(TripController.new);

class ActiveTripScreen extends ConsumerWidget {
  const ActiveTripScreen({super.key, required this.tripId});

  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trip = ref.watch(tripControllerProvider(tripId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Your trip'),
        leading: IconButton(icon: const Icon(Icons.arrow_back), onPressed: () => context.go('/home')),
      ),
      body: switch (trip) {
        AsyncLoading() => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) => Padding(
            padding: const EdgeInsets.all(16),
            child: ErrorBanner(message: error.toString()),
          ),
        AsyncValue(:final value?) => _TripDetail(trip: value, tripId: tripId),
      },
    );
  }
}

class _TripDetail extends ConsumerWidget {
  const _TripDetail({required this.trip, required this.tripId});

  final Trip trip;
  final String tripId;

  Future<void> _confirmCancel(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Cancel this trip?'),
        content: const Text('Your driver will be released to take other jobs.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep trip')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Cancel trip')),
        ],
      ),
    );
    if (confirmed != true) return;

    try {
      await ref.read(tripControllerProvider(tripId).notifier).cancel('Cancelled by passenger');
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final fare = trip.displayFare;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    if (trip.isActive)
                      const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                    else
                      const Icon(Icons.check_circle, color: Colors.green, size: 20),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(trip.statusLabel, style: Theme.of(context).textTheme.titleMedium),
                    ),
                  ],
                ),
                if (trip.status == 'TIMEOUT') ...[
                  const SizedBox(height: 8),
                  Text(
                    'No driver was available nearby. Try again in a few minutes.',
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _Row(icon: Icons.trip_origin, color: Colors.green, text: trip.pickupAddress),
                const SizedBox(height: 12),
                _Row(icon: Icons.place, color: Colors.red, text: trip.dropoffAddress ?? 'Destination not set yet'),
                if (trip.distanceMiles != null || fare != null) ...[
                  const Divider(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(trip.distanceMiles == null ? '' : '${trip.distanceMiles!.toStringAsFixed(1)} mi'),
                      if (fare != null)
                        Text(
                          '\$${fare.toStringAsFixed(2)}',
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Align(
                    alignment: Alignment.centerRight,
                    child: Text(
                      trip.finalFare != null ? 'Final fare · pay in cash' : 'Estimated · pay in cash',
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 24),
        // The API enforces the real rule (a started trip can no longer be
        // cancelled by the passenger); this just avoids offering a button
        // that would always fail.
        if (trip.isActive && trip.status != 'TRIP_STARTED')
          OutlinedButton(
            onPressed: () => _confirmCancel(context, ref),
            child: const Text('Cancel trip'),
          ),
      ],
    );
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.icon, required this.color, required this.text});

  final IconData icon;
  final Color color;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: color, size: 20),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    );
  }
}
