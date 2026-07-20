import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/providers.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/map_markers.dart';
import '../../widgets/trip_timeline.dart';

/// One recorded position on a trip.
class PathPoint {
  const PathPoint({required this.point, required this.recordedAt});

  final LatLng point;
  final DateTime recordedAt;

  factory PathPoint.fromJson(Map<String, dynamic> json) => PathPoint(
        point: LatLng((json['lat'] as num).toDouble(), (json['lng'] as num).toDouble()),
        recordedAt: DateTime.parse(json['recordedAt'] as String),
      );
}

final tripPathProvider = FutureProvider.family<List<PathPoint>, String>((ref, tripId) async {
  final raw = await ref.read(apiClientProvider).getList('/api/trips/$tripId/breadcrumbs');
  return raw.map((e) => PathPoint.fromJson(e as Map<String, dynamic>)).toList();
});

/// Where a car actually went, for the office.
///
/// This is the screen that answers a complaint. The fare on the trip is priced
/// from the road between pickup and dropoff, and it stays that way whatever
/// this shows — the path is not an input to the bill. What it is good for is
/// the question the fare cannot answer: the passenger says the driver took the
/// long way round, or the job took an hour and nobody can say why.
class AdminTripPathScreen extends ConsumerWidget {
  const AdminTripPathScreen({super.key, required this.tripId});

  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final path = ref.watch(tripPathProvider(tripId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Trip route'),
        leading: const AppBackButton(),
      ),
      body: switch (path) {
        AsyncLoading() => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) => Padding(
            padding: const EdgeInsets.all(16),
            child: ErrorBanner(message: error.toString()),
          ),
        AsyncValue(:final value?) => _Path(tripId: tripId, points: value),
      },
    );
  }
}

class _Path extends StatelessWidget {
  const _Path({required this.tripId, required this.points});

  final String tripId;
  final List<PathPoint> points;

  @override
  Widget build(BuildContext context) {
    if (points.isEmpty) {
      // Not an error. Older trips predate this recording, and a phone that was
      // offline for the whole journey has nothing to send — saying so beats an
      // empty map that looks broken.
      return ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const ErrorBanner(
            message: 'No route was recorded for this trip. That is normal for older trips, '
                'and for a journey where the driver had no signal.',
          ),
          const SizedBox(height: 24),
          Text('What happened', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          TripTimeline(tripId: tripId),
        ],
      );
    }

    final line = points.map((p) => p.point).toList();
    final bounds = LatLngBounds.fromPoints(line);
    final duration = points.last.recordedAt.difference(points.first.recordedAt);

    return Column(
      children: [
        Expanded(
          child: FlutterMap(
            options: MapOptions(
              initialCameraFit: CameraFit.bounds(
                bounds: bounds,
                padding: const EdgeInsets.all(40),
              ),
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.gnncab.app',
              ),
              PolylineLayer(
                polylines: [
                  Polyline(
                    points: line,
                    strokeWidth: 4,
                    color: Theme.of(context).colorScheme.primary,
                  ),
                ],
              ),
              // Same markers as every other map in the app, so a route reads
              // the same way here as it does to the passenger.
              MarkerLayer(
                markers: [
                  Marker(
                    point: line.first,
                    width: 28,
                    height: 28,
                    child: const LegendDot(isPickup: true),
                  ),
                  Marker(
                    point: line.last,
                    width: 28,
                    height: 28,
                    child: const LegendDot(isPickup: false),
                  ),
                ],
              ),
            ],
          ),
        ),
        Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                '${points.length} positions over ${_formatDuration(duration)}',
                style: Theme.of(context).textTheme.bodyMedium,
              ),
              const SizedBox(height: 4),
              Text(
                'Recorded while the passenger was in the car. The fare is worked out '
                'from the road between pickup and dropoff, not from this line.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ],
    );
  }

  String _formatDuration(Duration d) {
    if (d.inMinutes < 1) return 'under a minute';
    if (d.inMinutes < 60) return '${d.inMinutes} min';
    final hours = d.inHours;
    final mins = d.inMinutes % 60;
    return mins == 0 ? '$hours h' : '$hours h $mins min';
  }
}
