import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/driver_location_broadcaster.dart';
import 'package:nhtaxi/core/location_service.dart';
import 'package:nhtaxi/core/location_socket.dart';
import 'package:nhtaxi/core/providers.dart';
import 'package:latlong2/latlong.dart';

class _FixedLocation extends LocationService {
  const _FixedLocation(this.point);

  final LatLng? point;

  @override
  Future<LocationResult> current() async =>
      point == null ? const LocationResult.failure(LocationFailure.error) : LocationResult.success(point!);
}

/// A transport that never receives anything back — the broadcaster only
/// ever sends, so all these tests need is a record of what went out.
class _RecordingTransport implements LocationTransport {
  final sent = <String>[];

  @override
  Stream<dynamic> get stream => const Stream.empty();

  @override
  void send(String data) => sent.add(data);

  @override
  Future<void> close() async {}
}

ProviderContainer _containerWith(_RecordingTransport transport, LocationService location) {
  final container = ProviderContainer(
    overrides: [
      locationSocketProvider.overrideWithValue(LocationSocket(() async => transport)),
      locationServiceProvider.overrideWithValue(location),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('DriverLocationBroadcaster', () {
    test('sends a LOCATION_UPDATE immediately on start, without waiting a full interval', () async {
      // Dispatch and the passenger's live map are both blind to this driver
      // until the first point lands — waiting out the full cadence before
      // sending it would mean going online looks broken for several seconds.
      final transport = _RecordingTransport();
      final container = _containerWith(transport, const _FixedLocation(LatLng(44.05, -71.12)));

      container.read(driverLocationBroadcasterProvider).start();
      await Future<void>.delayed(Duration.zero);

      expect(transport.sent, hasLength(1));
      expect(transport.sent.single, contains('LOCATION_UPDATE'));
      expect(transport.sent.single, contains('44.05'));
    });

    test('sends nothing when the phone cannot get a fix, rather than erroring', () async {
      final transport = _RecordingTransport();
      final container = _containerWith(transport, const _FixedLocation(null));

      container.read(driverLocationBroadcasterProvider).start();
      await Future<void>.delayed(Duration.zero);

      expect(transport.sent, isEmpty);
    });

    test('stop() ends the run', () async {
      final transport = _RecordingTransport();
      final container = _containerWith(transport, const _FixedLocation(LatLng(44.05, -71.12)));

      final broadcaster = container.read(driverLocationBroadcasterProvider);
      broadcaster.start();
      expect(broadcaster.isRunning, isTrue);
      broadcaster.stop();
      expect(broadcaster.isRunning, isFalse);
    });

    test('start() is idempotent — a second call does not send a second burst', () async {
      final transport = _RecordingTransport();
      final container = _containerWith(transport, const _FixedLocation(LatLng(44.05, -71.12)));

      final broadcaster = container.read(driverLocationBroadcasterProvider);
      broadcaster.start();
      await Future<void>.delayed(Duration.zero);
      broadcaster.start();
      await Future<void>.delayed(Duration.zero);

      expect(transport.sent, hasLength(1));
    });
  });
}
