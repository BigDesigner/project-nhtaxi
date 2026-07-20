import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';
import '../models/trip.dart';

/// What actually happened on a trip, and when.
///
/// The server has written a `trip_events` row on every status change since
/// Faz 3 and nothing ever read them. They answer questions the current status
/// alone cannot: how long the driver took to arrive, whether a search was
/// restarted, who cancelled and at what point. Useful to a passenger checking
/// on a ride, and the closest thing to evidence the office has if a trip is
/// later disputed.
class TripEvent {
  const TripEvent({
    required this.id,
    required this.status,
    required this.createdAt,
    this.actorRole,
  });

  final String id;
  final String status;
  final DateTime createdAt;
  final String? actorRole;

  /// Reuses the passenger-facing wording so one trip doesn't get described two
  /// different ways on two screens.
  String get label => Trip(
        id: '',
        status: status,
        pickupAddress: '',
        requestedAt: createdAt,
        currency: 'USD',
      ).statusLabel;

  factory TripEvent.fromJson(Map<String, dynamic> json) => TripEvent(
        id: json['id'] as String,
        status: json['status'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        actorRole: json['actorRole'] as String?,
      );
}

final tripEventsProvider = FutureProvider.family<List<TripEvent>, String>((ref, tripId) async {
  final raw = await ref.read(apiClientProvider).getList('/api/trips/$tripId/events');
  return raw.map((e) => TripEvent.fromJson(e as Map<String, dynamic>)).toList();
});

class TripTimeline extends ConsumerWidget {
  const TripTimeline({super.key, required this.tripId});

  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final events = ref.watch(tripEventsProvider(tripId));

    return switch (events) {
      AsyncLoading() => const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Center(child: CircularProgressIndicator()),
      ),
      // A timeline is supporting detail, never the point of the screen — if it
      // fails to load it stays quiet rather than throwing an error banner over
      // information the user actually came for.
      AsyncError() => const SizedBox.shrink(),
      AsyncData(:final value) when value.isEmpty => const SizedBox.shrink(),
      AsyncData(:final value) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (var i = 0; i < value.length; i++)
            _Step(
              event: value[i],
              isFirst: i == 0,
              isLast: i == value.length - 1,
            ),
        ],
      ),
    };
  }
}

class _Step extends StatelessWidget {
  const _Step({required this.event, required this.isFirst, required this.isLast});

  final TripEvent event;
  final bool isFirst;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final colour = Theme.of(context).colorScheme.primary;

    return IntrinsicHeight(
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // The rail: a dot per event with a line joining them, so the passage
          // of time reads at a glance rather than from timestamps alone.
          SizedBox(
            width: 24,
            child: Column(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: 4),
                  decoration: BoxDecoration(
                    color: isFirst ? colour : colour.withValues(alpha: 0.4),
                    shape: BoxShape.circle,
                  ),
                ),
                if (!isLast)
                  Expanded(
                    child: Container(width: 2, color: colour.withValues(alpha: 0.2)),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Padding(
              padding: EdgeInsets.only(bottom: isLast ? 0 : 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(event.label, style: Theme.of(context).textTheme.bodyMedium),
                  Text(
                    [
                      _formatTime(event.createdAt),
                      // "system" here means dispatch acted on its own — a
                      // timed-out search, an automatic redispatch.
                      if (event.actorRole != null) 'by ${event.actorRole}',
                    ].join(' · '),
                    style: Theme.of(context).textTheme.bodySmall,
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  String _formatTime(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')} '
        '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
