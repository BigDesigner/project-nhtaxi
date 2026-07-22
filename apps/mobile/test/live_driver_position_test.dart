import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/live_driver_position.dart';
import 'package:nhtaxi/core/location_socket.dart';
import 'package:latlong2/latlong.dart';

/// A transport the test drives directly — `deliver` simulates a frame
/// arriving from LocationHub. Nothing is ever sent back; these providers
/// only ever read.
class _ControllableTransport implements LocationTransport {
  final _incoming = StreamController<dynamic>.broadcast();

  @override
  Stream<dynamic> get stream => _incoming.stream;

  @override
  void send(String data) {}

  @override
  Future<void> close() async {}

  void deliver(String raw) => _incoming.add(raw);
}

void main() {
  group('driverLivePositionProvider', () {
    test('reports positions only for the requested driverId', () async {
      // A passenger watching one trip must never see another driver's
      // movement mixed in — the filter here is the client-side half of that;
      // the server-side half is that the hub never sends it in the first
      // place unless this is the passenger's matched driver.
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);

      final sub = container.listen(driverLivePositionProvider('d1'), (_, _) {});
      await Future<void>.delayed(Duration.zero);

      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d2","lat":1.0,"lng":2.0}');
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.1,"lng":-71.2}');
      await Future<void>.delayed(Duration.zero);

      expect(container.read(driverLivePositionProvider('d1')).value?.point, const LatLng(44.1, -71.2));
      sub.close();
    });

    test('ignores messages that are not DRIVER_LOCATION', () async {
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);

      final sub = container.listen(driverLivePositionProvider('d1'), (_, _) {});
      await Future<void>.delayed(Duration.zero);

      transport.deliver('{"type":"ERROR","message":"nope"}');
      await Future<void>.delayed(Duration.zero);

      expect(container.read(driverLivePositionProvider('d1')).value, isNull);
      sub.close();
    });
  });

  group('fleetLivePositionsProvider', () {
    test('accumulates a running snapshot across every driver reported', () async {
      // Unlike the single-driver stream, the hub forwards every driver's
      // broadcast to an admin unconditionally, so this has to build up a map
      // rather than filter down to one ID.
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);

      final sub = container.listen(fleetLivePositionsProvider, (_, _) {});
      await Future<void>.delayed(Duration.zero);

      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":1.0,"lng":2.0}');
      await Future<void>.delayed(Duration.zero);
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d2","lat":3.0,"lng":4.0}');
      await Future<void>.delayed(Duration.zero);

      final snapshot = container.read(fleetLivePositionsProvider).value!;
      expect(snapshot['d1']!.point, const LatLng(1.0, 2.0));
      expect(snapshot['d2']!.point, const LatLng(3.0, 4.0));
      sub.close();
    });

    test('a later position from the same driver replaces the earlier one', () async {
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);

      final sub = container.listen(fleetLivePositionsProvider, (_, _) {});
      await Future<void>.delayed(Duration.zero);

      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":1.0,"lng":2.0}');
      await Future<void>.delayed(Duration.zero);
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":9.0,"lng":9.0}');
      await Future<void>.delayed(Duration.zero);

      expect(container.read(fleetLivePositionsProvider).value!['d1']!.point, const LatLng(9.0, 9.0));
      sub.close();
    });
  });

  group('heading (which way to point the car)', () {
    test('a due-north move reads as ~0°, a due-east move as ~90°', () {
      // Straight up in latitude with the same longitude is north.
      expect(bearingDegrees(const LatLng(44.0, -71.0), const LatLng(44.1, -71.0)), closeTo(0, 1));
      // Straight east in longitude at the same latitude.
      expect(bearingDegrees(const LatLng(44.0, -71.0), const LatLng(44.0, -70.9)), closeTo(90, 1));
    });

    test('holds the last heading while the driver sits still (GPS jitter, not travel)', () async {
      // Two points a few metres apart — below the movement threshold — must
      // not spin the car; it keeps facing the way it last actually drove.
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);
      final sub = container.listen(driverLivePositionProvider('d1'), (_, _) {});
      await Future<void>.delayed(Duration.zero);

      // Drives clearly east → establishes a ~90° heading.
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.00,"lng":-71.00}');
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.00,"lng":-70.99}');
      await Future<void>.delayed(Duration.zero);
      final moving = container.read(driverLivePositionProvider('d1')).value!;
      expect(moving.heading, closeTo(90, 1));

      // Now a tiny jitter (~1–2 m). Heading must be unchanged, not recomputed
      // toward the noise.
      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.00001,"lng":-70.99}');
      await Future<void>.delayed(Duration.zero);
      expect(container.read(driverLivePositionProvider('d1')).value!.heading, closeTo(90, 1));
      sub.close();
    });

    test('the very first fix has no heading yet — the car points up until there is movement', () async {
      final transport = _ControllableTransport();
      final container = ProviderContainer(
        overrides: [locationSocketProvider.overrideWithValue(LocationSocket(() async => transport))],
      );
      addTearDown(container.dispose);
      final sub = container.listen(driverLivePositionProvider('d1'), (_, _) {});
      await Future<void>.delayed(Duration.zero);

      transport.deliver('{"type":"DRIVER_LOCATION","driverId":"d1","lat":44.0,"lng":-71.0}');
      await Future<void>.delayed(Duration.zero);
      expect(container.read(driverLivePositionProvider('d1')).value!.heading, isNull);
      sub.close();
    });
  });
}
