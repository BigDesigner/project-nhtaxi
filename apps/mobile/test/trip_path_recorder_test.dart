import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/api_client.dart';
import 'package:nhtaxi/core/location_service.dart';
import 'package:nhtaxi/core/providers.dart';
import 'package:nhtaxi/core/token_store.dart';
import 'package:nhtaxi/core/trip_path_recorder.dart';
import 'package:latlong2/latlong.dart';

/// Records every call instead of making one, so a test can see exactly what
/// the recorder tried to send and answer however it likes.
class _FakeApi extends ApiClient {
  _FakeApi(super.tokenStore);

  final List<List<dynamic>> sentBatches = [];

  /// Set to make the next post fail the way a dead spot does.
  ApiException? failWith;

  @override
  Future<Map<String, dynamic>> post(String path, {Object? body, bool skipAuth = false}) async {
    final error = failWith;
    if (error != null) throw error;
    final points = (body as Map<String, dynamic>)['points'] as List<dynamic>;
    sentBatches.add(points);
    return {'recorded': points.length};
  }
}

class _FixedLocation extends LocationService {
  const _FixedLocation(this.point);

  final LatLng? point;

  @override
  Future<LocationResult> current() async =>
      point == null ? const LocationResult.failure(LocationFailure.error) : LocationResult.success(point!);
}

ProviderContainer _containerWith(_FakeApi api, LocationService location) {
  final container = ProviderContainer(
    overrides: [
      apiClientProvider.overrideWithValue(api),
      locationServiceProvider.overrideWithValue(location),
    ],
  );
  addTearDown(container.dispose);
  return container;
}

void main() {
  group('TripPathRecorder', () {
    test('sends the first point immediately rather than waiting a full interval', () async {
      // The pickup is the single most useful point on the whole path — waiting
      // 30 seconds for it would lose exactly the position that matters most.
      final api = _FakeApi(TokenStore());
      final container = _containerWith(api, const _FixedLocation(LatLng(44.05, -71.12)));

      container.read(tripPathRecorderProvider).start('trip-1');
      await Future<void>.delayed(Duration.zero);

      expect(api.sentBatches, hasLength(1));
      expect(api.sentBatches.first.first['lat'], 44.05);
    });

    test('keeps points when the upload fails, and sends them on the next flush', () async {
      // The whole reason this buffer exists. North Conway has real dead spots,
      // and dropping the points would mean the one stretch of road with no
      // coverage is exactly the stretch missing from the record — which is the
      // stretch someone will eventually ask about.
      final api = _FakeApi(TokenStore())..failWith = ApiException('offline');
      final container = _containerWith(api, const _FixedLocation(LatLng(44.06, -71.13)));
      final recorder = container.read(tripPathRecorderProvider);

      recorder.start('trip-2');
      await Future<void>.delayed(Duration.zero);
      expect(api.sentBatches, isEmpty);

      // Signal comes back.
      api.failWith = null;
      await recorder.stop();

      expect(api.sentBatches, hasLength(1));
      expect(api.sentBatches.first.first['lat'], 44.06);
    });

    test('drops points the server has closed the path to, instead of retrying forever', () async {
      // A 400 means the trip is finished and its path is a record now. Putting
      // these back would spin against an endpoint that will never accept them.
      final api = _FakeApi(TokenStore())..failWith = ApiException('closed', statusCode: 400);
      final container = _containerWith(api, const _FixedLocation(LatLng(44.07, -71.14)));
      final recorder = container.read(tripPathRecorderProvider);

      recorder.start('trip-3');
      await Future<void>.delayed(Duration.zero);

      api.failWith = null;
      await recorder.stop();

      expect(api.sentBatches, isEmpty);
    });

    test('carries on when the phone cannot get a fix', () async {
      // A refused or unavailable position is not worth interrupting a driving
      // job over — the next sample may well succeed.
      final api = _FakeApi(TokenStore());
      final container = _containerWith(api, const _FixedLocation(null));
      final recorder = container.read(tripPathRecorderProvider);

      recorder.start('trip-4');
      await Future<void>.delayed(Duration.zero);
      await recorder.stop();

      expect(api.sentBatches, isEmpty);
    });

    test('stops recording once the trip is over', () async {
      final api = _FakeApi(TokenStore());
      final container = _containerWith(api, const _FixedLocation(LatLng(44.08, -71.15)));
      final recorder = container.read(tripPathRecorderProvider);

      recorder.start('trip-5');
      expect(recorder.isRecording, isTrue);
      await recorder.stop();
      expect(recorder.isRecording, isFalse);
    });
  });
}
