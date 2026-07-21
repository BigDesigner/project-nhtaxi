import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../core/live_driver_position.dart';
import '../../core/providers.dart';
import '../../models/trip.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/car_marker.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
import '../../widgets/map_markers.dart';
import '../../widgets/search_countdown.dart';
import '../../widgets/trip_timeline.dart';
import 'rating/rate_trip_screen.dart';
import 'rating/rating_controller.dart';

/// Polls one trip's status.
///
/// Still polling rather than pushed: a handful of requests over a trip's
/// lifetime is well inside the free tier, and status changes (assigned,
/// arrived, started, completed) are infrequent enough that a socket buys
/// little here. What *is* worth pushing is the driver's position, which
/// changes every few seconds while they're moving — that part now comes over
/// LocationHub's WebSocket instead (see `_LiveTripMap` below and
/// `core/live_driver_position.dart`), layered on top of this poll rather than
/// replacing it.
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
        // A driver only exists to watch move once one is actually matched —
        // before that there is nothing at trip.driverId to ask LocationHub
        // for, and after a driver is released the hub simply stops sending.
        if (trip.isMatched && trip.driverId != null) ...[
          const SizedBox(height: 16),
          _LiveTripMap(trip: trip, driverId: trip.driverId!),
        ],
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
                          formatFare(fare, currency: trip.currency),
                          style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                        ),
                    ],
                  ),
                  // Only an estimate carries a ceiling; a final fare is a real
                  // charged amount. This block also renders when we have a
                  // distance but no fare at all, hence the null check.
                  if (fare != null) ...[
                    const SizedBox(height: 4),
                    Text(
                      trip.finalFare != null
                          ? 'Final fare · pay in cash'
                          : 'Pay in cash — ${fareCeilingNote(fare, currency: trip.currency)}.',
                      textAlign: TextAlign.right,
                      style: Theme.of(context).textTheme.bodySmall,
                    ),
                  ],
                ],
              ],
            ),
          ),
        ),
        // Rate the driver once the trip is over. Only for a completed trip
        // that actually had a driver — a timed-out search closed by the
        // passenger has nobody to rate.
        if (trip.status == 'TRIP_COMPLETED' && trip.driverId != null) ...[
          const SizedBox(height: 16),
          _RatingCard(tripId: tripId, driverId: trip.driverId!),
        ],
        const SizedBox(height: 16),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('What has happened', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 12),
                TripTimeline(tripId: tripId),
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

/// The driver moving, live, over LocationHub's WebSocket — replacing the
/// 10-second trip-status poll's static picture with something a passenger
/// can actually watch. The trip poll itself keeps running for status
/// changes; this is purely the driver's position layered on top.
class _LiveTripMap extends ConsumerStatefulWidget {
  const _LiveTripMap({required this.trip, required this.driverId});

  final Trip trip;
  final String driverId;

  @override
  ConsumerState<_LiveTripMap> createState() => _LiveTripMapState();
}

class _LiveTripMapState extends ConsumerState<_LiveTripMap> {
  final _mapController = MapController();
  bool _centered = false;

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final position = ref.watch(driverLivePositionProvider(widget.driverId));

    // Centre on the driver the moment their first position arrives, then
    // leave the view alone — recentring on every update would fight a
    // passenger who pinched or panned to look at something else.
    ref.listen(driverLivePositionProvider(widget.driverId), (_, next) {
      final point = next.value?.point;
      if (point != null && !_centered) {
        _centered = true;
        _mapController.move(point, 15);
      }
    });

    final pickup = LatLng(trip.pickupLat ?? 0, trip.pickupLng ?? 0);
    final hasDropoff = trip.dropoffLat != null && trip.dropoffLng != null;

    return ClipRRect(
      borderRadius: BorderRadius.circular(12),
      child: SizedBox(
        height: 220,
        child: FlutterMap(
          mapController: _mapController,
          options: MapOptions(initialCenter: pickup, initialZoom: 14),
          children: [
            TileLayer(
              urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
              userAgentPackageName: 'com.gnncab.gnncab',
            ),
            MarkerLayer(
              markers: [
                Marker(point: pickup, width: 32, height: 32, child: const TripPointMarker.pickup()),
                if (hasDropoff)
                  Marker(
                    point: LatLng(trip.dropoffLat!, trip.dropoffLng!),
                    width: 32,
                    height: 32,
                    child: const TripPointMarker.destination(),
                  ),
                if (position.value != null)
                  Marker(
                    point: position.value!.point,
                    width: 40,
                    height: 40,
                    child: CarMarker(
                      color: Theme.of(context).colorScheme.primary,
                      headingDegrees: position.value!.heading,
                    ),
                  ),
              ],
            ),
            const RichAttributionWidget(
              attributions: [TextSourceAttribution('OpenStreetMap contributors')],
            ),
          ],
        ),
      ),
    );
  }
}

/// Either a prompt to rate the completed trip, or — once rated — a read-only
/// recap. Which one shows is decided by the server (tripRatingProvider), so a
/// passenger who already rated on another device sees the recap here too.
class _RatingCard extends ConsumerWidget {
  const _RatingCard({required this.tripId, required this.driverId});

  final String tripId;
  final String driverId;

  Future<void> _openForm(BuildContext context, WidgetRef ref, String driverName) async {
    final done = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => RateTripScreen(tripId: tripId, driverName: driverName)),
    );
    if (done == true) ref.invalidate(tripRatingProvider(tripId));
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final rating = ref.watch(tripRatingProvider(tripId));

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: switch (rating) {
          // Keep quiet while loading rather than flashing a prompt that might
          // immediately be replaced by the "already rated" recap.
          AsyncLoading() => const SizedBox(
              height: 24,
              child: Center(child: SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))),
            ),
          AsyncError() => const SizedBox.shrink(),
          AsyncData(:final value?) => RatingSummary(rating: value),
          AsyncData() => Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('How was your trip?', style: Theme.of(context).textTheme.titleMedium),
                const SizedBox(height: 4),
                Text(
                  'Rate your driver so we can keep the service good.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const SizedBox(height: 12),
                FilledButton.icon(
                  onPressed: () => _openForm(context, ref, 'your driver'),
                  icon: const Icon(Icons.star_outline),
                  label: const Text('Rate this trip'),
                ),
              ],
            ),
        },
      ),
    );
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
