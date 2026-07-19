/// Mirrors AuthUserSchema / AdminUserSchema in packages/contract.
class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.phone,
  });

  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phone;

  /// 'customer' | 'driver' | 'admin'
  final String role;

  String get fullName => '$firstName $lastName';

  bool get isCustomer => role == 'customer';
  bool get isDriver => role == 'driver';
  bool get isAdmin => role == 'admin';

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        email: json['email'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        phone: json['phone'] as String?,
        role: json['role'] as String,
      );
}
