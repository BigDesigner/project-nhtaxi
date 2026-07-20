import 'package:latlong2/latlong.dart';

/// A driver as the passenger-facing map sees them (GET /api/drivers).
class DirectoryDriver {
  const DirectoryDriver({
    required this.driverId,
    required this.firstName,
    required this.status,
    this.lat,
    this.lng,
    this.distanceMiles,
    this.phone,
    this.vehicleMake,
    this.vehicleModel,
    this.vehicleColor,
    this.vehiclePlate,
    this.photoUrl,
    this.freeInMinutes,
  });

  final String driverId;
  final String firstName;
  final String status;
  final double? lat;
  final double? lng;
  final double? distanceMiles;
  final String? phone;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? vehicleColor;
  final String? vehiclePlate;
  final String? photoUrl;
  final int? freeInMinutes;

  factory DirectoryDriver.fromJson(Map<String, dynamic> json) => DirectoryDriver(
        driverId: json['driverId'] as String,
        firstName: json['firstName'] as String,
        status: json['status'] as String,
        lat: (json['lat'] as num?)?.toDouble(),
        lng: (json['lng'] as num?)?.toDouble(),
        distanceMiles: (json['distanceMiles'] as num?)?.toDouble(),
        phone: json['phone'] as String?,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehicleColor: json['vehicleColor'] as String?,
        vehiclePlate: json['vehiclePlate'] as String?,
        photoUrl: json['photoUrl'] as String?,
        freeInMinutes: (json['freeInMinutes'] as num?)?.toInt(),
      );

  /// Drivers without a position can't be drawn; they still show in the list.
  LatLng? get point => (lat != null && lng != null) ? LatLng(lat!, lng!) : null;

  bool get isAvailable => status == 'AVAILABLE';

  /// "Silver Toyota Sienna", skipping whatever the driver hasn't filled in.
  String? get vehicleDescription {
    final parts = [vehicleColor, vehicleMake, vehicleModel].where((p) => p != null && p.isNotEmpty);
    return parts.isEmpty ? null : parts.join(' ');
  }

  String get statusLabel => switch (status) {
        'AVAILABLE' => 'Available now',
        'RESERVED' => 'Reserved',
        'BUSY' => 'On a trip',
        _ => status,
      };

  /// The one-line answer to "can this person come and get me?".
  String get availabilityDetail {
    if (isAvailable) return 'Available now';
    // Only shown when the server could work it out honestly; otherwise the
    // plain status is all we claim.
    if (freeInMinutes != null) return '$statusLabel · free in about $freeInMinutes min';
    return statusLabel;
  }
}
