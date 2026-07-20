import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import 'location_socket.dart';

LatLng? _pointFrom(Map<String, dynamic> message) {
  final lat = message['lat'];
  final lng = message['lng'];
  if (lat is! num || lng is! num) return null;
  return LatLng(lat.toDouble(), lng.toDouble());
}

/// The live position of one driver, as reported over LocationHub's
/// `DRIVER_LOCATION` broadcast.
///
/// Scoped to a single `driverId` because that is all any one screen is
/// authorized to receive: the hub only forwards a driver's position to that
/// driver's currently-matched customer, plus every connected admin
/// (`apps/api/src/durable-objects/location-hub.ts`) — never to a passenger
/// who merely knows a driver's ID with no active trip together. A trip that
/// isn't matched yet, or has ended, simply never produces an event here.
final driverLivePositionProvider = StreamProvider.autoDispose.family<LatLng, String>((ref, driverId) {
  final socket = ref.watch(locationSocketProvider);
  unawaited(socket.connect());
  return socket.messages
      .where((m) => m['type'] == 'DRIVER_LOCATION' && m['driverId'] == driverId)
      .map(_pointFrom)
      .where((p) => p != null)
      .cast<LatLng>();
});

/// Every driver's most recently reported position, for the admin fleet map.
///
/// Unlike the single-driver stream above, the hub forwards *every* driver's
/// broadcast to a connected admin unconditionally — so this accumulates a
/// running snapshot rather than filtering to one ID. A driver who goes
/// offline simply stops appearing in new broadcasts; their last known point
/// stays on the map until the provider is disposed (leaving the screen),
/// which is the right default for "where was everyone a moment ago" rather
/// than needing a separate expiry mechanism for a map nobody is asked to
/// treat as gospel-fresh.
final fleetLivePositionsProvider = StreamProvider.autoDispose<Map<String, LatLng>>((ref) async* {
  final socket = ref.watch(locationSocketProvider);
  unawaited(socket.connect());
  final positions = <String, LatLng>{};
  await for (final message in socket.messages) {
    if (message['type'] != 'DRIVER_LOCATION') continue;
    final driverId = message['driverId'];
    if (driverId is! String) continue;
    final point = _pointFrom(message);
    if (point == null) continue;
    positions[driverId] = point;
    yield Map.of(positions);
  }
});
