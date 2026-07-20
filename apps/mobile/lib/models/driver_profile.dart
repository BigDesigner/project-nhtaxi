/// Mirrors DriverProfileResponseSchema (GET/PUT /api/driver/profile).
class DriverProfile {
  const DriverProfile({
    required this.id,
    required this.userId,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.isVerified,
    required this.totalTrips,
    this.phone,
    this.licenseNumber,
    this.vehicleMake,
    this.vehicleModel,
    this.vehicleYear,
    this.vehicleColor,
    this.vehiclePlate,
    this.rating,
  });

  final String id;
  final String userId;
  final String email;
  final String firstName;
  final String lastName;

  /// AVAILABLE / RESERVED / BUSY / OFFLINE. A driver may only set the first
  /// and last of those themselves — dispatch owns BUSY and RESERVED.
  final String status;

  final bool isVerified;
  final int totalTrips;
  final String? phone;
  final String? licenseNumber;
  final String? vehicleMake;
  final String? vehicleModel;
  final int? vehicleYear;
  final String? vehicleColor;
  final String? vehiclePlate;
  final double? rating;

  /// The driver is clocked on and billable, whether or not they're mid-job.
  bool get isOnline => status != 'OFFLINE';

  /// Free to be given a new trip.
  bool get isAvailable => status == 'AVAILABLE';

  /// Mid-job — the toggle has to explain why it can't be flipped right now.
  bool get isOnJob => status == 'BUSY' || status == 'RESERVED';

  String get fullName => '$firstName $lastName';

  String get statusLabel => switch (status) {
        'AVAILABLE' => 'Online — waiting for a job',
        'RESERVED' => 'Job offered',
        'BUSY' => 'On a job',
        'OFFLINE' => 'Offline',
        _ => status,
      };

  /// "Silver Toyota Sienna", skipping anything not filled in yet.
  String? get vehicleDescription {
    final parts = [vehicleColor, vehicleMake, vehicleModel].where((p) => p != null && p.isNotEmpty);
    return parts.isEmpty ? null : parts.join(' ');
  }

  /// What a passenger needs to identify the car at the kerb. Missing any of
  /// it is worth nagging the driver about — it's shown on the driver map.
  bool get hasCompleteVehicle =>
      (vehicleMake?.isNotEmpty ?? false) &&
      (vehicleModel?.isNotEmpty ?? false) &&
      (vehiclePlate?.isNotEmpty ?? false);

  factory DriverProfile.fromJson(Map<String, dynamic> json) => DriverProfile(
        id: json['id'] as String,
        userId: json['userId'] as String,
        email: json['email'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        status: json['status'] as String,
        isVerified: json['isVerified'] as bool? ?? false,
        totalTrips: (json['totalTrips'] as num?)?.toInt() ?? 0,
        phone: json['phone'] as String?,
        licenseNumber: json['licenseNumber'] as String?,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehicleYear: (json['vehicleYear'] as num?)?.toInt(),
        vehicleColor: json['vehicleColor'] as String?,
        vehiclePlate: json['vehiclePlate'] as String?,
        rating: (json['rating'] as num?)?.toDouble(),
      );
}
