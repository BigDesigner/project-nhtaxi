import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'providers.dart';

/// Records where the car actually went while a passenger is aboard.
///
/// This is **evidence, not billing**. The fare comes from asking a routing
/// engine what the journey between pickup and dropoff should cost, and that
/// stays true regardless of what this records — summing these points would let
/// GPS jitter inflate every trip and would make the price depend on the
/// quality of a phone's signal. What the path answers is the question routing
/// cannot: where was this car, and when. That is what matters when a passenger
/// disputes a trip or the office needs to know why a job took an hour.
///
/// Two decisions worth keeping:
///
///  * **Points carry the time the device saw them, not the time the server
///    received them.** North Conway has real dead spots; a phone coming back
///    into signal on the Kancamagus uploads a backlog, and the order that
///    matters is the order it was driven.
///  * **A failed upload keeps its points.** They go back on the front of the
///    buffer and go out with the next flush. Dropping them would mean the one
///    stretch of road with no coverage is exactly the stretch missing from the
///    record — which is the stretch someone will eventually ask about.
class TripPathRecorder {
  TripPathRecorder(this._ref);

  final Ref _ref;

  /// Roughly one point per street. Often enough to draw a recognisable route,
  /// rare enough that a full shift is a few hundred rows rather than tens of
  /// thousands — the free tier's write allowance is generous but not infinite.
  static const sampleInterval = Duration(seconds: 30);

  /// Matches the server's per-request cap.
  static const _maxBatch = 200;

  Timer? _timer;
  String? _tripId;
  final List<Map<String, dynamic>> _buffer = [];
  bool _flushing = false;

  bool get isRecording => _tripId != null;

  /// Starts recording for [tripId]. Safe to call repeatedly for the same trip.
  void start(String tripId) {
    if (_tripId == tripId) return;
    stop();
    _tripId = tripId;
    _timer = Timer.periodic(sampleInterval, (_) => _sample());
    // Don't wait 30 seconds for the first point — the pickup itself is the
    // most useful one on the whole path.
    _sample();
  }

  /// Stops recording and makes a final attempt to send whatever is buffered.
  Future<void> stop() async {
    _timer?.cancel();
    _timer = null;
    if (_tripId == null) return;
    await _flush();
    _tripId = null;
    _buffer.clear();
  }

  Future<void> _sample() async {
    final result = await _ref.read(locationServiceProvider).current();
    final point = result.point;
    // A refused or unavailable fix is not an error worth interrupting a
    // driving job for — the next sample may well succeed.
    if (point == null) return;

    _buffer.add({
      'lat': point.latitude,
      'lng': point.longitude,
      'recordedAt': DateTime.now().toUtc().toIso8601String(),
    });
    await _flush();
  }

  Future<void> _flush() async {
    final tripId = _tripId;
    if (tripId == null || _buffer.isEmpty || _flushing) return;

    _flushing = true;
    final batch = _buffer.take(_maxBatch).toList();
    _buffer.removeRange(0, batch.length);
    try {
      await _ref.read(apiClientProvider).post(
            '/api/trips/$tripId/breadcrumbs',
            body: {'points': batch},
          );
    } on ApiException catch (e) {
      // 400 means the server has closed this trip's path — the points have
      // nowhere to go and retrying forever would just spin. Anything else is
      // treated as transient: put them back and try again next tick.
      if (e.statusCode != 400) {
        _buffer.insertAll(0, batch);
      }
    } finally {
      _flushing = false;
    }
  }
}

final tripPathRecorderProvider = Provider<TripPathRecorder>((ref) {
  final recorder = TripPathRecorder(ref);
  ref.onDispose(recorder.stop);
  return recorder;
});
