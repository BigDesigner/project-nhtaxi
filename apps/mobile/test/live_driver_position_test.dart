import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/core/live_driver_position.dart';
import 'package:gnncab/core/location_socket.dart';
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

      expect(container.read(driverLivePositionProvider('d1')).value, const LatLng(44.1, -71.2));
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

      expect(container.read(fleetLivePositionsProvider).value, {
        'd1': const LatLng(1.0, 2.0),
        'd2': const LatLng(3.0, 4.0),
      });
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

      expect(container.read(fleetLivePositionsProvider).value, {'d1': const LatLng(9.0, 9.0)});
      sub.close();
    });
  });
}
