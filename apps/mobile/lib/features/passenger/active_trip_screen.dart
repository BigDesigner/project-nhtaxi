import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../core/providers.dart';
import '../../models/trip.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
import '../../widgets/map_markers.dart';
import '../../widgets/search_countdown.dart';

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

  /// Refreshes often enough that the countdown lines up with the server's
  /// 60-second sweep without the client hammering the API — the server does
  /// the actual searching, this just keeps the display honest.
  static const _pollInterval = Duration(seconds: 10);

  @override
  Future<Trip> build() async {
    _timer?.cancel();
    _timer = Timer.periodic(_pollInterval, (_) => _poll());
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

  /// Re-arms the server's search loop after it gave up.
  Future<void> retrySearch() async {
    final json = await ref.read(apiClientProvider).post('/api/trips/$tripId/retry');
    state = AsyncData(Trip.fromJson(json));
    _timer?.cancel();
    _timer = Timer.periodic(_pollInterval, (_) => _poll());
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
        leading: const AppBackButton(),
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
            child: trip.isSearching
                ? SearchCountdown(trip: trip)
                : Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          if (trip.isActive)
                            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                          else if (trip.status == 'TIMEOUT')
                            const Icon(Icons.search_off, size: 20)
                          else
                            const Icon(Icons.check_circle, color: Colors.green, size: 20),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(trip.statusLabel, style: Theme.of(context).textTheme.titleMedium),
                          ),
                        ],
                      ),
                      if (trip.canRetrySearch) ...[
                        const SizedBox(height: 8),
                        Text(
                          'We checked for ${trip.maxSearchAttempts} minutes and no driver came free. '
                          'You can start the search again, or call us.',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 12),
                        FilledButton.icon(
                          onPressed: () => _retry(context, ref),
                          icon: const Icon(Icons.refresh),
                          label: const Text('Search again'),
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
                _Row(isPickup: true, text: trip.pickupAddress),
                const SizedBox(height: 12),
                _Row(isPickup: false, text: trip.dropoffAddress ?? 'Destination not set yet'),
                if (trip.distanceMiles != null || fare != null) ...[
                  const Divider(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(trip.distanceMiles == null ? '' : '${trip.distanceMiles!.toStringAsFixed(1)} mi'),
                      if (fare != null)
                        Text(
                          trip.finalFare != null
                              ? formatFare(fare, currency: trip.currency)
                              : formatFareRange(fare, currency: trip.currency),
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                        ),
                    ],
                  ),
                  const SizedBox(height: 4),
                  Text(
                    trip.finalFare != null
                        ? 'Final fare · pay in cash'
                        : 'Estimated range · the route your driver takes, traffic and closures '
                            'can move the final fare within this band. Pay in cash.',
                    textAlign: TextAlign.right,
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        // Shown wherever a passenger might be stuck: a search that came up
        // empty is exactly when they want a human.
        if (trip.isSearching || trip.canRetrySearch) const HelpCard(),
        const SizedBox(height: 8),
        // The API enforces the real rule; this just avoids offering a button
        // that would always fail.
        if (trip.canCancel)
          OutlinedButton(
            onPressed: () => _confirmCancel(context, ref),
            child: Text(trip.canRetrySearch ? 'Close this request' : 'Cancel trip'),
          )
        // Past this point the driver is already moving, so cancelling goes
        // through a person. Saying why — and offering the call — beats a
        // greyed-out button with no explanation.
        else if (trip.mustCallToCancel)
          const HelpCard(
            title: 'Need to cancel?',
            message: 'Your driver is already on the way. Call dispatch and we will sort it out.',
          ),
      ],
    );
  }

  Future<void> _retry(BuildContext context, WidgetRef ref) async {
    try {
      await ref.read(tripControllerProvider(tripId).notifier).retrySearch();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }
}

class _Row extends StatelessWidget {
  const _Row({required this.isPickup, required this.text});

  final bool isPickup;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        // Same markers as the booking map, so the two screens describe the
        // same trip in the same visual language.
        SizedBox(width: 20, child: Center(child: LegendDot(isPickup: isPickup))),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    );
  }
}
