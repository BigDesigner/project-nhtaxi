import 'dart:async';
import 'dart:math' as math;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import 'location_socket.dart';

/// A driver's live position plus the direction they're heading, so the map
/// can point a car the right way.
class LiveDriverPosition {
  const LiveDriverPosition({required this.point, this.heading});

  final LatLng point;

  /// Compass bearing in degrees (0 = north, 90 = east), or null until the
  /// driver has actually moved far enough to establish one. Null leaves the
  /// car pointing up rather than guessing a direction from GPS jitter.
  final double? heading;
}

/// How far a driver must move between two reports before we treat it as real
/// travel and re-aim the car. Positions arrive roughly every 10s; a moving
/// taxi covers tens of metres in that time, while a parked one jitters by a
/// few. 15m sits cleanly between the two, so a stationary car holds its last
/// heading instead of spinning on GPS noise.
const _minMoveMetres = 15.0;

const _distance = Distance();

LatLng? _pointFrom(Map<String, dynamic> message) {
  final lat = message['lat'];
  final lng = message['lng'];
  if (lat is! num || lng is! num) return null;
  return LatLng(lat.toDouble(), lng.toDouble());
}

/// Compass bearing from one point to the next, degrees clockwise from north.
double bearingDegrees(LatLng from, LatLng to) {
  final lat1 = from.latitude * math.pi / 180;
  final lat2 = to.latitude * math.pi / 180;
  final dLon = (to.longitude - from.longitude) * math.pi / 180;
  final y = math.sin(dLon) * math.cos(lat2);
  final x = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dLon);
  final deg = math.atan2(y, x) * 180 / math.pi;
  return (deg + 360) % 360;
}

/// Given the previous position and a new one, the heading to show: a fresh
/// bearing if the driver moved beyond the jitter threshold, otherwise the
/// heading they already had (a parked car keeps facing the way it last drove).
double? _nextHeading(LatLng? prev, double? prevHeading, LatLng next) {
  if (prev == null) return prevHeading;
  if (_distance(prev, next) < _minMoveMetres) return prevHeading;
  return bearingDegrees(prev, next);
}

/// The live position + heading of one driver, from LocationHub's
/// `DRIVER_LOCATION` broadcast.
///
/// Scoped to a single `driverId` because that is all any one screen is
/// authorized to receive: the hub only forwards a driver's position to that
/// driver's currently-matched customer, plus every connected admin
/// (`apps/api/src/durable-objects/location-hub.ts`) — never to a passenger
/// who merely knows a driver's ID with no active trip together.
final driverLivePositionProvider =
    StreamProvider.autoDispose.family<LiveDriverPosition, String>((ref, driverId) async* {
  final socket = ref.watch(locationSocketProvider);
  unawaited(socket.connect());

  LatLng? prev;
  double? heading;
  await for (final message in socket.messages) {
    if (message['type'] != 'DRIVER_LOCATION' || message['driverId'] != driverId) continue;
    final point = _pointFrom(message);
    if (point == null) continue;
    heading = _nextHeading(prev, heading, point);
    prev = point;
    yield LiveDriverPosition(point: point, heading: heading);
  }
});

/// Every driver's most recent position + heading, for the admin fleet map.
///
/// Unlike the single-driver stream above, the hub forwards *every* driver's
/// broadcast to a connected admin unconditionally — so this accumulates a
/// running snapshot rather than filtering to one ID. A driver who goes
/// offline simply stops appearing in new broadcasts; their last known point
/// stays on the map until the provider is disposed (leaving the screen).
final fleetLivePositionsProvider =
    StreamProvider.autoDispose<Map<String, LiveDriverPosition>>((ref) async* {
  final socket = ref.watch(locationSocketProvider);
  unawaited(socket.connect());

  final positions = <String, LiveDriverPosition>{};
  await for (final message in socket.messages) {
    if (message['type'] != 'DRIVER_LOCATION') continue;
    final driverId = message['driverId'];
    if (driverId is! String) continue;
    final point = _pointFrom(message);
    if (point == null) continue;
    final prev = positions[driverId];
    final heading = _nextHeading(prev?.point, prev?.heading, point);
    positions[driverId] = LiveDriverPosition(point: point, heading: heading);
    yield Map.of(positions);
  }
});
