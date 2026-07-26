/// Mirrors CustomerProfileResponseSchema (GET /api/customer/profile).
class CustomerProfile {
  const CustomerProfile({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.totalTrips,
    this.phone,
    this.preferredPaymentMethod,
  });

  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phone;
  final String? preferredPaymentMethod;
  final int totalTrips;

  factory CustomerProfile.fromJson(Map<String, dynamic> json) {
    return CustomerProfile(
      id: json['id'] as String,
      email: json['email'] as String,
      firstName: json['firstName'] as String,
      lastName: json['lastName'] as String,
      phone: json['phone'] as String?,
      preferredPaymentMethod: json['preferredPaymentMethod'] as String?,
      totalTrips: (json['totalTrips'] as num?)?.toInt() ?? 0,
    );
  }
}
