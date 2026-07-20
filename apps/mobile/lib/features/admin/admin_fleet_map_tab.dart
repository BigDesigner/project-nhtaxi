import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/live_driver_position.dart';
import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

const _serviceAreaCenter = LatLng(44.0537, -71.1281);

/// Where the fleet actually is, right now.
///
/// LocationHub has forwarded every driver's position to a connected admin
/// unconditionally since Faz 4 — this is the first screen that puts it in
/// front of a person. Names and status come from the ordinary driver list
/// (`GET /api/admin/drivers`); only the coordinates come over the socket, so
/// a driver who hasn't sent one yet (offline, or the app just isn't running
/// this wave's broadcaster) simply doesn't have a dot rather than a stale or
/// wrong one.
class AdminFleetMapTab extends ConsumerWidget {
  const AdminFleetMapTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drivers = ref.watch(adminDriversProvider);
    final positions = ref.watch(fleetLivePositionsProvider);

    return switch (drivers) {
      AsyncLoading() when !drivers.hasValue => const Center(child: CircularProgressIndicator()),
      AsyncError(:final error) when !drivers.hasValue => Padding(
        padding: const EdgeInsets.all(16),
        child: ErrorBanner(message: error.toString()),
      ),
      AsyncValue(:final value?) => _FleetMap(drivers: value, positions: positions.value ?? const {}),
      _ => const SizedBox.shrink(),
    };
  }
}

class _FleetMap extends StatelessWidget {
  const _FleetMap({required this.drivers, required this.positions});

  final List<AdminDriver> drivers;
  final Map<String, LatLng> positions;

  @override
  Widget build(BuildContext context) {
    final byId = {for (final d in drivers) d.id: d};
    // Only plot drivers we can actually name — a stray ID with no matching
    // driver record (shouldn't happen, but a dot with nothing to say about it
    // is worse than one fewer dot) is silently dropped rather than shown bare.
    final located = positions.entries.where((e) => byId.containsKey(e.key)).toList();

    return Column(
      children: [
        Expanded(
          child: FlutterMap(
            options: const MapOptions(initialCenter: _serviceAreaCenter, initialZoom: 12),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.gnncab.gnncab',
              ),
              MarkerLayer(
                markers: [
                  for (final entry in located)
                    Marker(
                      point: entry.value,
                      width: 44,
                      height: 44,
                      child: _FleetMarker(driver: byId[entry.key]!),
                    ),
                ],
              ),
              const RichAttributionWidget(
                attributions: [TextSourceAttribution('OpenStreetMap contributors')],
              ),
            ],
          ),
        ),
        if (located.isEmpty)
          const Padding(
            padding: EdgeInsets.all(16),
            child: Text(
              'No live positions yet. A driver appears here within a few seconds '
              'of going online.',
              textAlign: TextAlign.center,
            ),
          )
        else
          Padding(
            padding: const EdgeInsets.all(12),
            child: Text(
              '${located.length} of ${drivers.length} driver${drivers.length == 1 ? '' : 's'} reporting a live position',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ),
      ],
    );
  }
}

class _FleetMarker extends StatelessWidget {
  const _FleetMarker({required this.driver});

  final AdminDriver driver;

  @override
  Widget build(BuildContext context) {
    final color = switch (driver.status) {
      'AVAILABLE' => Colors.green,
      'RESERVED' => Colors.amber.shade800,
      'BUSY' => Colors.red,
      _ => Colors.grey,
    };

    return Tooltip(
      message: '${driver.fullName} · ${driver.status.toLowerCase()}',
      child: Container(
        decoration: BoxDecoration(
          color: color,
          shape: BoxShape.circle,
          border: Border.all(color: Colors.white, width: 2),
          boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 4)],
        ),
        child: const Icon(Icons.local_taxi, color: Colors.white, size: 22),
      ),
    );
  }
}
