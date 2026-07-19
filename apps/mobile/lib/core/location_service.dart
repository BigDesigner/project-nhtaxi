import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

/// Why a location request didn't produce a position — the UI needs to tell
/// these apart, because "you said no" and "GPS is switched off" need
/// different wording and different recovery.
enum LocationFailure { serviceDisabled, denied, deniedForever, error }

class LocationResult {
  const LocationResult.success(this.point) : failure = null;
  const LocationResult.failure(this.failure) : point = null;

  final LatLng? point;
  final LocationFailure? failure;

  bool get isSuccess => point != null;
}

class LocationService {
  const LocationService();

  /// Asks for permission if we don't have it yet, then returns the device
  /// position. Never throws — a passenger who declines must still be able to
  /// book by typing an address, so refusal is a normal outcome, not an error.
  Future<LocationResult> current() async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) {
        return const LocationResult.failure(LocationFailure.serviceDisabled);
      }

      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied) {
        permission = await Geolocator.requestPermission();
      }
      if (permission == LocationPermission.deniedForever) {
        return const LocationResult.failure(LocationFailure.deniedForever);
      }
      if (permission == LocationPermission.denied) {
        return const LocationResult.failure(LocationFailure.denied);
      }

      final position = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
      );
      return LocationResult.success(LatLng(position.latitude, position.longitude));
    } catch (_) {
      return const LocationResult.failure(LocationFailure.error);
    }
  }

  static String messageFor(LocationFailure failure) => switch (failure) {
        LocationFailure.serviceDisabled => 'Location is turned off. Turn it on, or set your pickup by searching for an address.',
        LocationFailure.denied => 'Location permission declined — set your pickup by searching for an address instead.',
        LocationFailure.deniedForever =>
          'Location is blocked for this app in your settings. You can still set your pickup by searching for an address.',
        LocationFailure.error => 'Could not get your location. Set your pickup by searching for an address instead.',
      };
}
