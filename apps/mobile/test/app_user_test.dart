import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/models/user.dart';

Map<String, dynamic> userJson({required String role, bool? isAdmin}) => {
      'id': 'u1',
      'email': 'a@example.com',
      'firstName': 'Ada',
      'lastName': 'Min',
      'role': role,
      'isAdmin': isAdmin,
    };

void main() {
  group('AppUser — dual role (owner-operator)', () {
    test('an ordinary customer is neither admin nor switchable', () {
      final u = AppUser.fromJson(userJson(role: 'customer'));
      expect(u.isAdmin, isFalse);
      expect(u.canSwitchRoleView, isFalse);
    });

    test('an ordinary driver with no isAdmin flag is neither admin nor switchable', () {
      final u = AppUser.fromJson(userJson(role: 'driver'));
      expect(u.isAdmin, isFalse);
      expect(u.canSwitchRoleView, isFalse);
    });

    test('a traditional admin account is admin but has nothing to switch to', () {
      // role: 'admin' has no driver side, so the toggle would have nowhere
      // useful to send it.
      final u = AppUser.fromJson(userJson(role: 'admin'));
      expect(u.isAdmin, isTrue);
      expect(u.canSwitchRoleView, isFalse);
    });

    test('a driver account with isAdmin: true is admin AND switchable', () {
      // The owner-operator shape: role stays 'driver' so the whole driver
      // app treats this account like any other driver.
      final u = AppUser.fromJson(userJson(role: 'driver', isAdmin: true));
      expect(u.isDriver, isTrue);
      expect(u.isAdmin, isTrue);
      expect(u.canSwitchRoleView, isTrue);
    });

    test('missing isAdmin in the wire response defaults to false, not a crash', () {
      final json = userJson(role: 'driver')..remove('isAdmin');
      final u = AppUser.fromJson(json);
      expect(u.hasAdminAccess, isFalse);
    });
  });
}
