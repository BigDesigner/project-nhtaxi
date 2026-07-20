import 'dart:async';
import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/providers.dart';
import '../../models/driver_billing.dart';
import '../../models/driver_document.dart';
import '../../models/driver_profile.dart';
import '../../models/trip.dart';

/// The signed-in driver's own profile, and the online/offline switch.
///
/// Going online is not just a UI state: the server opens a billable session
/// (lib/driver-sessions.ts) and starts charging by the minute. So the toggle
/// is always driven by what the server says, never by optimistic local state
/// — showing "online" when the server disagrees would either bill a driver
/// who thinks they're off, or leave them missing jobs while they think
/// they're on.
class DriverProfileController extends AsyncNotifier<DriverProfile> {
  @override
  Future<DriverProfile> build() => _fetch();

  Future<DriverProfile> _fetch() async {
    final json = await ref.read(apiClientProvider).get('/api/driver/profile');
    return DriverProfile.fromJson(json);
  }

  Future<void> refresh() async {
    state = await AsyncValue.guard(_fetch);
  }

  /// Flips between AVAILABLE and OFFLINE. Throws [ApiException] so the caller
  /// can show why it failed — most often because dispatch has the driver on a
  /// job and the server refuses to strand a passenger mid-trip.
  Future<void> setOnline(bool online) async {
    final json = await ref.read(apiClientProvider).put(
          '/api/driver/profile',
          body: {'status': online ? 'AVAILABLE' : 'OFFLINE'},
        );
    state = AsyncData(DriverProfile.fromJson(json));
    // The balance starts or stops moving at exactly this point.
    ref.invalidate(driverBalanceProvider);
    ref.invalidate(driverSessionsProvider);
  }

  /// Vehicle details, which the passenger-facing driver map renders.
  Future<void> updateVehicle(Map<String, dynamic> fields) async {
    final json = await ref.read(apiClientProvider).put('/api/driver/profile', body: fields);
    state = AsyncData(DriverProfile.fromJson(json));
  }

  /// Profile photo, shown to passengers picking a driver.
  Future<void> uploadPhoto(Uint8List bytes, String contentType) async {
    final json = await ref.read(apiClientProvider).postBytes('/api/driver/photo', bytes, contentType);
    state = AsyncData(DriverProfile.fromJson(json));
  }
}

final driverProfileProvider =
    AsyncNotifierProvider<DriverProfileController, DriverProfile>(DriverProfileController.new);

/// The driver's trips, newest first.
///
/// Polls while anything is live. A driver waiting for work needs to hear
/// about an offer within the 60-second accept window, so this is a good deal
/// more eager than the passenger's list — but it still stops dead once
/// there's nothing active, which is most of the time.
class DriverTripsController extends AsyncNotifier<List<Trip>> {
  Timer? _timer;

  static const _pollInterval = Duration(seconds: 8);

  @override
  Future<List<Trip>> build() async {
    ref.onDispose(() => _timer?.cancel());
    final trips = await _fetch();
    _syncPolling(trips);
    return trips;
  }

  Future<List<Trip>> _fetch() async {
    final raw = await ref.read(apiClientProvider).getList('/api/trips');
    return raw.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
  }

  void _syncPolling(List<Trip> trips) {
    if (trips.any((t) => t.isActive)) {
      _timer ??= Timer.periodic(_pollInterval, (_) => _poll());
    } else {
      _timer?.cancel();
      _timer = null;
    }
  }

  Future<void> _poll() async {
    try {
      final trips = await _fetch();
      state = AsyncData(trips);
      _syncPolling(trips);
    } on ApiException {
      // Transient — keep the last good list and try again next tick.
    }
  }

  /// Re-reads without blanking the list (same reasoning as the passenger's).
  Future<void> refresh() async {
    try {
      final trips = await _fetch();
      state = AsyncData(trips);
      _syncPolling(trips);
    } on ApiException catch (e) {
      if (!state.hasValue) state = AsyncError(e, StackTrace.current);
    }
  }

  /// Drives the whole job through its states: accept, decline, on my way,
  /// arrived, passenger aboard, dropped off.
  Future<void> setStatus(String tripId, String status, {bool? gnnReferred}) async {
    await ref.read(apiClientProvider).put(
      '/api/trips/$tripId/status',
      // Only sent on accept; the server ignores it elsewhere and will not let
      // it clear a referral the office already set.
      body: {'status': status, 'gnnReferred': ?gnnReferred},
    );
    await refresh();
    // Accepting or finishing a job moves the driver between AVAILABLE and
    // BUSY, and finishing an admin-assigned one books a commission charge.
    ref.invalidate(driverProfileProvider);
    if (status == 'TRIP_COMPLETED') ref.invalidate(driverBalanceProvider);
  }
}

final driverTripsProvider =
    AsyncNotifierProvider<DriverTripsController, List<Trip>>(DriverTripsController.new);

/// The single job needing the driver's attention right now, if any.
///
/// A driver can only be on one trip at a time, so rather than making every
/// screen hunt through the list for it, this picks it once. An offer waiting
/// to be accepted outranks a job already under way — the offer expires.
final currentJobProvider = Provider<Trip?>((ref) {
  final trips = ref.watch(driverTripsProvider).value ?? const <Trip>[];
  final offered = trips.where((t) => t.status == 'DRIVER_ASSIGNED');
  if (offered.isNotEmpty) return offered.first;
  final live = trips.where((t) => t.isActive && t.status != 'DRIVER_REJECTED');
  return live.isEmpty ? null : live.first;
});

final driverBalanceProvider = FutureProvider<DriverBalance>((ref) async {
  final json = await ref.read(apiClientProvider).get('/api/driver/balance');
  return DriverBalance.fromJson(json);
});

/// The driver's own document statuses — never the bytes. Those are
/// envelope-encrypted and only an admin can read them back.
final driverDocumentsProvider = FutureProvider<List<DriverDocument>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/driver/documents');
  return raw.map((e) => DriverDocument.fromJson(e as Map<String, dynamic>)).toList();
});

/// Uploads an identity document. The server encrypts it before it is stored.
Future<void> uploadDriverDocument(WidgetRef ref, String type, Uint8List bytes, String contentType) async {
  await ref.read(apiClientProvider).postBytes('/api/driver/documents/$type', bytes, contentType);
  ref.invalidate(driverDocumentsProvider);
}

final driverSessionsProvider = FutureProvider<List<DriverSession>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/driver/sessions');
  return raw.map((e) => DriverSession.fromJson(e as Map<String, dynamic>)).toList();
});
