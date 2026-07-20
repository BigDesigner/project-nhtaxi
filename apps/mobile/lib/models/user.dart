/// Mirrors AuthUserSchema / AdminUserSchema in packages/contract.
class AppUser {
  const AppUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    this.phone,
    this.hasAdminAccess = false,
  });

  final String id;
  final String email;
  final String firstName;
  final String lastName;
  final String? phone;

  /// 'customer' | 'driver' | 'admin'
  final String role;

  /// Orthogonal to [role] — see the schema comment on `users.isAdmin`
  /// (packages/db). True only for the owner-operator account, which keeps
  /// `role == 'driver'` (so the whole driver app treats it as an ordinary
  /// driver) while also being allowed into the admin panel.
  final bool hasAdminAccess;

  String get fullName => '$firstName $lastName';

  bool get isCustomer => role == 'customer';
  bool get isDriver => role == 'driver';

  /// Whether this account can reach the admin panel at all — a traditional
  /// admin account, or a driver account carrying [hasAdminAccess]. This is
  /// "can", not "currently viewing as" — see `viewModeProvider` for which
  /// shell is actually on screen for an account where both are true.
  bool get isAdmin => role == 'admin' || hasAdminAccess;

  /// True only for the dual-role shape: a driver who can also switch into
  /// the admin panel. A traditional pure-admin account has nothing to
  /// switch to, so it doesn't need the toggle this drives.
  bool get canSwitchRoleView => role == 'driver' && hasAdminAccess;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        email: json['email'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        phone: json['phone'] as String?,
        role: json['role'] as String,
        hasAdminAccess: json['isAdmin'] as bool? ?? false,
      );
}
