import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';
import '../../../core/geocoding.dart';
import '../../../core/providers.dart';
import '../../../models/directory_driver.dart';
import '../../../models/fare_estimate.dart';
import '../../../models/trip.dart';

class BookingState {
  const BookingState({
    this.pickup,
    this.dropoff,
    this.estimate,
    this.isEstimating = false,
    this.isSubmitting = false,
    this.error,
    this.preferredDriver,
  });

  final GeoPlace? pickup;
  final GeoPlace? dropoff;
  final FareEstimate? estimate;
  final bool isEstimating;
  final bool isSubmitting;
  final String? error;

  /// Set when the passenger picked someone off the driver map. Dispatch
  /// treats it as a first offer, not a guarantee (see routes/trips.ts).
  final DirectoryDriver? preferredDriver;

  bool get isComplete => pickup != null && dropoff != null;
  bool get canSubmit => isComplete && estimate != null && !isSubmitting;

  BookingState copyWith({
    GeoPlace? pickup,
    GeoPlace? dropoff,
    FareEstimate? estimate,
    bool? isEstimating,
    bool? isSubmitting,
    String? error,
    DirectoryDriver? preferredDriver,
    bool clearEstimate = false,
    bool clearError = false,
    bool clearPreferredDriver = false,
  }) {
    return BookingState(
      pickup: pickup ?? this.pickup,
      dropoff: dropoff ?? this.dropoff,
      estimate: clearEstimate ? null : (estimate ?? this.estimate),
      isEstimating: isEstimating ?? this.isEstimating,
      isSubmitting: isSubmitting ?? this.isSubmitting,
      error: clearError ? null : (error ?? this.error),
      preferredDriver: clearPreferredDriver ? null : (preferredDriver ?? this.preferredDriver),
    );
  }
}

class BookingController extends Notifier<BookingState> {
  @override
  BookingState build() => const BookingState();

  void setPickup(GeoPlace place) {
    state = state.copyWith(pickup: place, clearEstimate: true, clearError: true);
    _estimateIfReady();
  }

  void setDropoff(GeoPlace place) {
    state = state.copyWith(dropoff: place, clearEstimate: true, clearError: true);
    _estimateIfReady();
  }

  void setPreferredDriver(DirectoryDriver driver) => state = state.copyWith(preferredDriver: driver);

  void clearPreferredDriver() => state = state.copyWith(clearPreferredDriver: true);

  void reset() => state = const BookingState();

  /// Quotes the fare as soon as both ends are known (plan §4.9 — the
  /// passenger sees distance and price *before* committing).
  Future<void> _estimateIfReady() async {
    final pickup = state.pickup;
    final dropoff = state.dropoff;
    if (pickup == null || dropoff == null) return;

    state = state.copyWith(isEstimating: true, clearError: true);
    try {
      final json = await ref.read(apiClientProvider).post(
        '/api/trips/estimate',
        body: {
          'pickupLat': pickup.point.latitude,
          'pickupLng': pickup.point.longitude,
          'dropoffLat': dropoff.point.latitude,
          'dropoffLng': dropoff.point.longitude,
        },
      );
      state = state.copyWith(estimate: FareEstimate.fromJson(json), isEstimating: false);
    } on ApiException catch (e) {
      state = state.copyWith(isEstimating: false, error: e.message);
    }
  }

  /// Books the trip. Returns the created trip so the caller can navigate to
  /// it; dispatch then happens server-side (DispatchCoordinator).
  Future<Trip?> submit() async {
    final pickup = state.pickup;
    final dropoff = state.dropoff;
    if (pickup == null || dropoff == null) return null;

    state = state.copyWith(isSubmitting: true, clearError: true);
    try {
      final json = await ref.read(apiClientProvider).post(
        '/api/trips',
        body: {
          'pickupLat': pickup.point.latitude,
          'pickupLng': pickup.point.longitude,
          'pickupAddress': pickup.shortName,
          'dropoffLat': dropoff.point.latitude,
          'dropoffLng': dropoff.point.longitude,
          'dropoffAddress': dropoff.shortName,
          'paymentMethod': 'cash',
          if (state.preferredDriver != null) 'preferredDriverId': state.preferredDriver!.driverId,
        },
      );
      state = state.copyWith(isSubmitting: false);
      return Trip.fromJson(json);
    } on ApiException catch (e) {
      state = state.copyWith(isSubmitting: false, error: e.message);
      return null;
    }
  }
}

final bookingControllerProvider = NotifierProvider<BookingController, BookingState>(BookingController.new);
