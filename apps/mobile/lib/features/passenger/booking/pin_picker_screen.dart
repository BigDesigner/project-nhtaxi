import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/geocoding.dart';
import '../../../core/providers.dart';
import '../../../widgets/map_markers.dart';

/// Confirm-or-adjust a location on the map.
///
/// The pin is fixed to the centre of the screen and the map moves underneath
/// it, rather than the pin being dragged. Dragging a small target with the
/// same finger that pans the map is fiddly on a phone and fights the map's
/// own gestures; moving the map under a fixed pin is what every mapping app
/// settled on, and it works identically with touch and mouse.
class PinPickerScreen extends ConsumerStatefulWidget {
  const PinPickerScreen({
    super.key,
    required this.title,
    required this.initial,
    required this.isPickup,
    this.initialAddress,
  });

  final String title;
  final LatLng initial;

  /// Picks which marker to show, so the pin being placed matches the one that
  /// will appear on the booking map afterwards.
  final bool isPickup;
  final String? initialAddress;

  @override
  ConsumerState<PinPickerScreen> createState() => _PinPickerScreenState();
}

class _PinPickerScreenState extends ConsumerState<PinPickerScreen> {
  final _mapController = MapController();
  Timer? _debounce;

  /// How far the pin must move before the shown address is considered stale.
  /// Settling the map, or a fingertip's worth of drift, shouldn't throw away
  /// a perfectly good address and force another Nominatim round trip.
  static const _staleDistanceMeters = 20.0;

  static const _distance = Distance();

  late LatLng _point = widget.initial;
  late String? _address = widget.initialAddress;
  /// Where [_address] was resolved for, so tiny movements can be ignored.
  late LatLng? _addressPoint = widget.initialAddress == null ? null : widget.initial;
  bool _resolving = false;
  Future<void>? _inFlight;

  @override
  void initState() {
    super.initState();
    if (_address == null) _resolveAddress();
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  /// Reverse-geocodes after the map settles. Debounced for the same reason
  /// address search is: Nominatim allows about one request a second, and a
  /// pan generates a continuous stream of position updates.
  void _onMapMoved(MapCamera camera, bool hasGesture) {
    if (!hasGesture) return;
    _point = camera.center;

    // Still describing essentially the same spot — leave the address alone.
    if (_addressPoint != null && _distance(_addressPoint!, _point) < _staleDistanceMeters) return;

    _debounce?.cancel();
    setState(() {
      _address = null;
      _addressPoint = null;
      _resolving = true;
    });
    _debounce = Timer(GeocodingService.searchDebounce, _resolveAddress);
  }

  Future<void> _resolveAddress() async {
    final target = _point;
    setState(() => _resolving = true);
    final future = _run(target);
    _inFlight = future;
    await future;
  }

  Future<void> _run(LatLng target) async {
    try {
      final name = await ref.read(geocodingProvider).reverse(target);
      if (!mounted) return;
      setState(() {
        // A late reply for a spot the passenger has since panned away from
        // would label the pin with the wrong street.
        if (target == _point) {
          _address = name;
          _addressPoint = name == null ? null : target;
        }
        _resolving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _resolving = false);
    }
  }

  Future<void> _confirm() async {
    // Tapping Confirm while the lookup is still in flight used to hand back
    // bare coordinates, which is what the passenger then saw on their trip
    // card instead of a street name. Wait for the pending answer first.
    if (_resolving && _inFlight != null) {
      await _inFlight;
      if (!mounted) return;
    }
    // Retry once before giving up: the reverse lookup often lands right
    // behind an address search and gets rate-limited by Nominatim.
    if (_address == null) {
      await _resolveAddress();
      if (!mounted) return;
    }

    // Coordinates remain the last resort — some pickup spots genuinely have
    // no street address, and a usable flow beats a blocked one.
    final label = _address ??
        '${_point.latitude.toStringAsFixed(5)}, ${_point.longitude.toStringAsFixed(5)}';
    if (!mounted) return;
    Navigator.of(context).pop(GeoPlace(displayName: label, point: _point));
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          Expanded(
            child: Stack(
              alignment: Alignment.center,
              children: [
                FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: widget.initial,
                    initialZoom: 16,
                    onPositionChanged: _onMapMoved,
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.gnncab.gnncab',
                    ),
                    const RichAttributionWidget(
                      attributions: [TextSourceAttribution('OpenStreetMap contributors')],
                    ),
                  ],
                ),
                // Sits slightly above centre so the pin's tip, not its middle,
                // marks the spot the map is centred on.
                IgnorePointer(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: 48),
                    child: widget.isPickup ? const PickupMarker() : const DestinationMarker(),
                  ),
                ),
                Positioned(
                  top: 12,
                  left: 12,
                  right: 12,
                  child: Card(
                    color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.95),
                    child: const Padding(
                      padding: EdgeInsets.all(12),
                      child: Text('Move the map to place the pin exactly where you want it.'),
                    ),
                  ),
                ),
              ],
            ),
          ),
          Material(
            elevation: 8,
            child: SafeArea(
              top: false,
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        LegendDot(isPickup: widget.isPickup),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _resolving
                              ? Row(
                                  children: [
                                    const SizedBox(
                                        width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
                                    const SizedBox(width: 8),
                                    Text('Finding address…', style: Theme.of(context).textTheme.bodySmall),
                                  ],
                                )
                              : Text(
                                  _address ?? 'Address not found — the pin location will still be used',
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: _confirm,
                      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                      child: const Text('Confirm this location'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
