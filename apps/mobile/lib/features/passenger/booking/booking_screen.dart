import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/geocoding.dart';
import '../../../widgets/error_banner.dart';
import 'address_search_sheet.dart';
import 'booking_controller.dart';

/// North Conway, NH — the single service area (L21).
const _serviceAreaCenter = LatLng(44.0537, -71.1281);

class BookingScreen extends ConsumerStatefulWidget {
  const BookingScreen({super.key});

  @override
  ConsumerState<BookingScreen> createState() => _BookingScreenState();
}

class _BookingScreenState extends ConsumerState<BookingScreen> {
  final _mapController = MapController();

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _pick({required bool isPickup}) async {
    final place = await showModalBottomSheet<GeoPlace>(
      context: context,
      isScrollControlled: true,
      builder: (_) => AddressSearchSheet(title: isPickup ? 'Pickup location' : 'Where to?'),
    );
    if (place == null || !mounted) return;

    final controller = ref.read(bookingControllerProvider.notifier);
    isPickup ? controller.setPickup(place) : controller.setDropoff(place);
    _fitToSelection();
  }

  /// Keeps both pins on screen once they're known, so the passenger can see
  /// the whole route rather than one arbitrary end of it.
  void _fitToSelection() {
    final state = ref.read(bookingControllerProvider);
    final points = [
      if (state.pickup != null) state.pickup!.point,
      if (state.dropoff != null) state.dropoff!.point,
    ];
    if (points.isEmpty) return;
    if (points.length == 1) {
      _mapController.move(points.first, 15);
      return;
    }
    _mapController.fitCamera(
      CameraFit.bounds(bounds: LatLngBounds.fromPoints(points), padding: const EdgeInsets.all(64)),
    );
  }

  Future<void> _submit() async {
    final trip = await ref.read(bookingControllerProvider.notifier).submit();
    if (trip == null || !mounted) return;
    ref.read(bookingControllerProvider.notifier).reset();
    context.go('/trip/${trip.id}');
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(bookingControllerProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Request a trip')),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: const MapOptions(initialCenter: _serviceAreaCenter, initialZoom: 13),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      // OSM tile usage policy requires identifying the app.
                      userAgentPackageName: 'com.gnncab.gnncab',
                    ),
                    MarkerLayer(
                      markers: [
                        if (state.pickup != null)
                          Marker(
                            point: state.pickup!.point,
                            width: 40,
                            height: 40,
                            child: const Icon(Icons.trip_origin, color: Colors.green, size: 32),
                          ),
                        if (state.dropoff != null)
                          Marker(
                            point: state.dropoff!.point,
                            width: 40,
                            height: 40,
                            child: const Icon(Icons.place, color: Colors.red, size: 36),
                          ),
                      ],
                    ),
                    const RichAttributionWidget(
                      attributions: [TextSourceAttribution('OpenStreetMap contributors')],
                    ),
                  ],
                ),
              ],
            ),
          ),
          _BookingPanel(
            state: state,
            onPickPickup: () => _pick(isPickup: true),
            onPickDropoff: () => _pick(isPickup: false),
            onSubmit: _submit,
          ),
        ],
      ),
    );
  }
}

class _BookingPanel extends StatelessWidget {
  const _BookingPanel({
    required this.state,
    required this.onPickPickup,
    required this.onPickDropoff,
    required this.onSubmit,
  });

  final BookingState state;
  final VoidCallback onPickPickup;
  final VoidCallback onPickDropoff;
  final VoidCallback onSubmit;

  @override
  Widget build(BuildContext context) {
    return Material(
      elevation: 8,
      child: SafeArea(
        top: false,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _AddressRow(
                icon: Icons.trip_origin,
                iconColor: Colors.green,
                label: 'Pickup',
                value: state.pickup?.shortName,
                onTap: onPickPickup,
              ),
              const Divider(height: 8),
              _AddressRow(
                icon: Icons.place,
                iconColor: Colors.red,
                label: 'Destination',
                value: state.dropoff?.shortName,
                onTap: onPickDropoff,
              ),
              if (state.error != null) ...[
                const SizedBox(height: 12),
                ErrorBanner(message: state.error!),
              ],
              if (state.isEstimating) ...[
                const SizedBox(height: 16),
                const LinearProgressIndicator(),
              ],
              if (state.estimate != null) ...[
                const SizedBox(height: 12),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('${state.estimate!.distanceMiles.toStringAsFixed(1)} mi'),
                      Text(
                        '\$${state.estimate!.estimatedFare.toStringAsFixed(2)}',
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  'Estimated fare · pay the driver in cash',
                  style: Theme.of(context).textTheme.bodySmall,
                  textAlign: TextAlign.center,
                ),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: state.canSubmit ? onSubmit : null,
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                child: state.isSubmitting
                    ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                    : const Text('Request trip'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _AddressRow extends StatelessWidget {
  const _AddressRow({
    required this.icon,
    required this.iconColor,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final Color iconColor;
  final String label;
  final String? value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(
          children: [
            Icon(icon, color: iconColor, size: 20),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label, style: Theme.of(context).textTheme.bodySmall),
                  Text(
                    value ?? 'Tap to choose',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: value == null
                        ? TextStyle(color: Theme.of(context).hintColor)
                        : Theme.of(context).textTheme.bodyLarge,
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right),
          ],
        ),
      ),
    );
  }
}
