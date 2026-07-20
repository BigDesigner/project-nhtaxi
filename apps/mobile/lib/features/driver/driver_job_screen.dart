import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../models/trip.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/map_markers.dart';
import 'driver_controllers.dart';
import 'job_actions.dart';

/// One job in full: where it goes, what it pays, and what to do next.
class DriverJobScreen extends ConsumerWidget {
  const DriverJobScreen({super.key, required this.tripId});

  final String tripId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final trips = ref.watch(driverTripsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Job'), leading: const AppBackButton()),
      body: switch (trips) {
        AsyncLoading() when !trips.hasValue => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) when !trips.hasValue => Padding(
            padding: const EdgeInsets.all(16),
            child: ErrorBanner(message: error.toString()),
          ),
        AsyncValue(:final value?) => _resolve(context, value),
        _ => const SizedBox.shrink(),
      },
    );
  }

  Widget _resolve(BuildContext context, List<Trip> trips) {
    final match = trips.where((t) => t.id == tripId);
    if (match.isEmpty) {
      // Reachable if the job was reassigned away, or on a cold deep link
      // before the list has caught up.
      return const Padding(
        padding: EdgeInsets.all(24),
        child: Center(child: Text('This job is no longer assigned to you.')),
      );
    }
    return _JobDetail(job: match.first);
  }
}

class _JobDetail extends StatelessWidget {
  const _JobDetail({required this.job});

  final Trip job;

  Future<void> _navigateTo(BuildContext context, double lat, double lng, String label) async {
    // Hands off to whatever mapping app the driver already uses rather than
    // trying to do turn-by-turn ourselves. `geo:` is the Android intent;
    // the https fallback covers iOS and the web build.
    final geo = Uri.parse('geo:$lat,$lng?q=$lat,$lng(${Uri.encodeComponent(label)})');
    if (await canLaunchUrl(geo)) {
      await launchUrl(geo);
      return;
    }
    await launchUrl(
      Uri.parse('https://www.openstreetmap.org/directions?to=$lat,$lng'),
      mode: LaunchMode.externalApplication,
    );
  }

  @override
  Widget build(BuildContext context) {
    final pickup = (job.pickupLat != null && job.pickupLng != null)
        ? LatLng(job.pickupLat!, job.pickupLng!)
        : null;
    final dropoff = (job.dropoffLat != null && job.dropoffLng != null)
        ? LatLng(job.dropoffLat!, job.dropoffLng!)
        : null;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(job.statusLabel, style: Theme.of(context).textTheme.titleMedium),
                if (job.origin == 'ADMIN_ASSIGNED')
                  Text('Assigned by the office', style: Theme.of(context).textTheme.bodySmall),
                const SizedBox(height: 16),
                _Leg(
                  isPickup: true,
                  label: 'Pick up',
                  address: job.pickupAddress,
                  onNavigate: pickup == null
                      ? null
                      : () => _navigateTo(context, pickup.latitude, pickup.longitude, job.pickupAddress),
                ),
                const SizedBox(height: 12),
                _Leg(
                  isPickup: false,
                  label: 'Drop off',
                  address: job.dropoffAddress ?? 'The passenger will give you this at pickup',
                  onNavigate: dropoff == null
                      ? null
                      : () => _navigateTo(context, dropoff.latitude, dropoff.longitude, job.dropoffAddress ?? 'Drop off'),
                ),
              ],
            ),
          ),
        ),
        if (pickup != null) ...[
          const SizedBox(height: 16),
          SizedBox(
            height: 220,
            child: ClipRRect(
              borderRadius: BorderRadius.circular(12),
              child: FlutterMap(
                options: MapOptions(
                  initialCenter: pickup,
                  initialZoom: 13,
                  // A reference map, not a tool — the driver navigates in
                  // their own app via the buttons above.
                  interactionOptions: const InteractionOptions(flags: InteractiveFlag.none),
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.gnncab.gnncab',
                  ),
                  MarkerLayer(
                    markers: [
                      Marker(point: pickup, width: 56, height: 56, child: const TripPointMarker.pickup()),
                      if (dropoff != null)
                        Marker(
                          point: dropoff,
                          width: 56,
                          height: 56,
                          child: const TripPointMarker.destination(),
                        ),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ],
        const SizedBox(height: 16),
        JobEarningsSummary(job: job),
        const SizedBox(height: 16),
        JobActions(job: job),
      ],
    );
  }
}

class _Leg extends StatelessWidget {
  const _Leg({
    required this.isPickup,
    required this.label,
    required this.address,
    required this.onNavigate,
  });

  final bool isPickup;
  final String label;
  final String address;
  final VoidCallback? onNavigate;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 20, child: Center(child: LegendDot(isPickup: isPickup))),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: Theme.of(context).textTheme.bodySmall),
              Text(address, style: Theme.of(context).textTheme.bodyLarge),
            ],
          ),
        ),
        if (onNavigate != null)
          IconButton(
            tooltip: 'Open in maps',
            icon: const Icon(Icons.directions),
            onPressed: onNavigate,
          ),
      ],
    );
  }
}
