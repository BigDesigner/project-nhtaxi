import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/providers.dart';
import '../../../models/directory_driver.dart';
import '../../../widgets/app_back_button.dart';
import '../../../widgets/car_marker.dart';
import '../../../widgets/driver_avatar.dart';
import '../../../widgets/error_banner.dart';
import '../../../widgets/star_rating.dart';
import '../booking/booking_controller.dart';
import '../rating/rating_controller.dart';
import 'drivers_controller.dart';

/// North Conway, NH — the single service area (L21).
const _serviceAreaCenter = LatLng(44.0537, -71.1281);

/// Green free, red busy, amber reserved — the colours the passenger asked for.
/// Each also gets its own icon, because colour alone is unreadable to a good
/// share of people.
({Color color, IconData icon}) _marker(DirectoryDriver d) => switch (d.status) {
  'AVAILABLE' => (color: Colors.green, icon: Icons.local_taxi),
  'RESERVED' => (color: Colors.amber.shade800, icon: Icons.schedule),
  _ => (color: Colors.red, icon: Icons.do_not_disturb_on),
};

class DriversScreen extends ConsumerStatefulWidget {
  const DriversScreen({super.key});

  @override
  ConsumerState<DriversScreen> createState() => _DriversScreenState();
}

class _DriversScreenState extends ConsumerState<DriversScreen> {
  final _mapController = MapController();

  @override
  void initState() {
    super.initState();
    // Knowing where the passenger is turns the list into "who's near me",
    // which is the whole point. A refusal just leaves it unsorted.
    WidgetsBinding.instance.addPostFrameCallback((_) => _locate());
  }

  @override
  void dispose() {
    _mapController.dispose();
    super.dispose();
  }

  Future<void> _locate() async {
    final result = await ref.read(locationServiceProvider).current();
    if (!mounted || !result.isSuccess) return;
    await ref.read(driversControllerProvider.notifier).locate(result.point!);
    if (mounted) _mapController.move(result.point!, 13);
  }

  void _openDriver(DirectoryDriver driver) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _DriverSheet(
        driver: driver,
        onRequest: () {
          Navigator.pop(context);
          // Booking still needs a destination, so we carry the choice into
          // the normal booking flow rather than trying to book from here.
          ref.read(bookingControllerProvider.notifier).setPreferredDriver(driver);
          context.go('/home/book');
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final drivers = ref.watch(driversControllerProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Drivers'),
        leading: const AppBackButton(),
        actions: [
          IconButton(
            tooltip: 'Refresh',
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.read(driversControllerProvider.notifier).refresh(),
          ),
        ],
      ),
      body: switch (drivers) {
        AsyncLoading() when !drivers.hasValue => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) when !drivers.hasValue => Padding(
          padding: const EdgeInsets.all(16),
          child: ErrorBanner(message: error.toString()),
        ),
        AsyncValue(:final value?) => _DriversBody(
          drivers: value,
          mapController: _mapController,
          onTap: _openDriver,
        ),
        _ => const SizedBox.shrink(),
      },
    );
  }
}

class _DriversBody extends StatelessWidget {
  const _DriversBody({required this.drivers, required this.mapController, required this.onTap});

  final List<DirectoryDriver> drivers;
  final MapController mapController;
  final void Function(DirectoryDriver) onTap;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Expanded(
          flex: 3,
          child: FlutterMap(
            mapController: mapController,
            options: const MapOptions(initialCenter: _serviceAreaCenter, initialZoom: 12),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.gnncab.gnncab',
              ),
              MarkerLayer(
                markers: [
                  for (final d in drivers)
                    if (d.point != null)
                      Marker(
                        point: d.point!,
                        width: 44,
                        height: 44,
                        child: GestureDetector(
                          onTap: () => onTap(d),
                          child: _MarkerPin(driver: d),
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
        Expanded(
          flex: 2,
          // The map stays up even with nobody on shift. Replacing the whole
          // screen with a sentence made it look broken, and left no way to
          // tell "no drivers" apart from "the map failed to load".
          child: drivers.isEmpty
              ? const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'No drivers are on shift right now.\n'
                      'You can still request a trip — we will keep looking for you.',
                      textAlign: TextAlign.center,
                    ),
                  ),
                )
              : ListView.builder(
                  itemCount: drivers.length,
                  itemBuilder: (context, i) {
                    final d = drivers[i];
                    final m = _marker(d);
                    return ListTile(
                      leading: DriverAvatar(name: d.firstName, photoUrl: d.photoUrl, color: m.color),
                      title: Row(
                        children: [
                          Flexible(child: Text(d.firstName, overflow: TextOverflow.ellipsis)),
                          const SizedBox(width: 8),
                          RatingChip(rating: d.rating, count: d.ratingCount),
                        ],
                      ),
                      subtitle: Text(
                        [
                          d.availabilityDetail,
                          if (d.vehicleDescription != null) d.vehicleDescription!,
                        ].join(' · '),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                      trailing: d.distanceMiles == null
                          ? null
                          : Text('${d.distanceMiles!.toStringAsFixed(1)} mi'),
                      onTap: () => onTap(d),
                    );
                  },
                ),
        ),
      ],
    );
  }
}

class _MarkerPin extends StatelessWidget {
  const _MarkerPin({required this.driver});

  final DirectoryDriver driver;

  @override
  Widget build(BuildContext context) {
    // This is a snapshot list, not a live feed, so there's no heading to aim
    // by — the car points up. The status colour is what it carries here; the
    // list row and sheet say the status in words.
    return CarMarker(color: _marker(driver).color, size: 40);
  }
}

class _DriverSheet extends ConsumerWidget {
  const _DriverSheet({required this.driver, required this.onRequest});

  final DirectoryDriver driver;
  final VoidCallback onRequest;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final m = _marker(driver);

    return SafeArea(
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                DriverAvatar(name: driver.firstName, photoUrl: driver.photoUrl, radius: 32, color: m.color),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Flexible(child: Text(driver.firstName, style: Theme.of(context).textTheme.titleLarge)),
                          const SizedBox(width: 8),
                          RatingChip(rating: driver.rating, count: driver.ratingCount),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Row(
                        children: [
                          Icon(m.icon, size: 16, color: m.color),
                          const SizedBox(width: 6),
                          Flexible(
                            child: Text(
                              driver.availabilityDetail,
                              style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: m.color),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 24),
            if (driver.vehicleDescription != null)
              _DetailRow(icon: Icons.directions_car, label: 'Vehicle', value: driver.vehicleDescription!),
            if (driver.vehiclePlate != null)
              _DetailRow(
                icon: Icons.confirmation_number_outlined,
                label: 'Plate',
                value: driver.vehiclePlate!,
              ),
            if (driver.phone != null) _DetailRow(icon: Icons.phone, label: 'Phone', value: driver.phone!),
            if (driver.distanceMiles != null)
              _DetailRow(
                icon: Icons.near_me,
                label: 'Distance',
                value: '${driver.distanceMiles!.toStringAsFixed(1)} miles away',
              ),
            _DriverReviewsSection(driverId: driver.driverId),
            const SizedBox(height: 24),
            if (driver.isAvailable)
              FilledButton.icon(
                onPressed: onRequest,
                icon: const Icon(Icons.local_taxi),
                label: Text('Request ${driver.firstName}'),
                style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
              )
            else
              // Requesting a busy driver would just fall through to whoever is
              // free, which isn't what the passenger asked for. Saying so is
              // better than a button that quietly does something else.
              Text(
                '${driver.firstName} is not free right now. Request a trip and we will find you the nearest driver, '
                'or check back in a few minutes.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
          ],
        ),
      ),
    );
  }
}

/// Per-question averages and recent comments for the driver, loaded on demand
/// when the sheet opens. Stays quiet (nothing rendered) until it has something
/// real to show — a driver with no ratings gets no empty "Reviews" heading.
class _DriverReviewsSection extends ConsumerWidget {
  const _DriverReviewsSection({required this.driverId});

  final String driverId;

  static const _labels = {
    'courtesy': 'Courtesy',
    'safety': 'Safe driving',
    'punctuality': 'On time',
    'communication': 'Kept me informed',
    'cleanliness': 'Clean vehicle',
  };

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final reviews = ref.watch(driverReviewsProvider(driverId));
    final value = reviews.value;
    if (value == null || value.ratingCount == 0) return const SizedBox.shrink();

    return Padding(
      padding: const EdgeInsets.only(top: 20),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Ratings', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          if (value.averages != null)
            for (final entry in _labels.entries)
              if (value.averages![entry.key] != null)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 2),
                  child: Row(
                    children: [
                      Expanded(child: Text(entry.value, style: Theme.of(context).textTheme.bodyMedium)),
                      StarDisplay(value: value.averages![entry.key]!, size: 15),
                    ],
                  ),
                ),
          if (value.recent.isNotEmpty) ...[
            const SizedBox(height: 12),
            for (final r in value.recent)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    StarDisplay(value: r.overall, size: 14),
                    if (r.comment != null) Text('“${r.comment!}”', style: Theme.of(context).textTheme.bodySmall),
                  ],
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _DetailRow extends StatelessWidget {
  const _DetailRow({required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        children: [
          Icon(icon, size: 20, color: Theme.of(context).hintColor),
          const SizedBox(width: 16),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
          const Spacer(),
          Flexible(
            child: Text(value, textAlign: TextAlign.end, style: Theme.of(context).textTheme.bodyLarge),
          ),
        ],
      ),
    );
  }
}
