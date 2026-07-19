import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../../core/geocoding.dart';
import '../../../core/providers.dart';

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
    this.initialAddress,
  });

  final String title;
  final LatLng initial;
  final String? initialAddress;

  @override
  ConsumerState<PinPickerScreen> createState() => _PinPickerScreenState();
}

class _PinPickerScreenState extends ConsumerState<PinPickerScreen> {
  final _mapController = MapController();
  Timer? _debounce;

  late LatLng _point = widget.initial;
  late String? _address = widget.initialAddress;
  bool _resolving = false;

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
    _debounce?.cancel();
    setState(() {
      _address = null;
      _resolving = true;
    });
    _debounce = Timer(GeocodingService.searchDebounce, _resolveAddress);
  }

  Future<void> _resolveAddress() async {
    setState(() => _resolving = true);
    try {
      final name = await ref.read(geocodingProvider).reverse(_point);
      if (!mounted) return;
      setState(() {
        _address = name;
        _resolving = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() => _resolving = false);
    }
  }

  void _confirm() {
    // Falling back to coordinates keeps the flow usable when reverse
    // geocoding fails or the spot genuinely has no street address.
    final label = _address ??
        '${_point.latitude.toStringAsFixed(5)}, ${_point.longitude.toStringAsFixed(5)}';
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
                const IgnorePointer(
                  child: Padding(
                    padding: EdgeInsets.only(bottom: 36),
                    child: Icon(Icons.place, size: 48, color: Colors.red),
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
                        const Icon(Icons.place_outlined, size: 20),
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
