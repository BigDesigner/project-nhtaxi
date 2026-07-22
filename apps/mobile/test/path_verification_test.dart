import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/path_verification.dart';

void main() {
  group('TripPathVerification', () {
    test('NOT_CHECKED is unchecked, not mismatched', () {
      final v = TripPathVerification.fromJson({'status': 'NOT_CHECKED', 'deviationMiles': null});
      expect(v.isChecked, isFalse);
      expect(v.isMismatched, isFalse);
    });

    test('MATCHED is checked and not mismatched', () {
      final v = TripPathVerification.fromJson({'status': 'MATCHED', 'deviationMiles': 0.12});
      expect(v.isChecked, isTrue);
      expect(v.isMismatched, isFalse);
      expect(v.deviationMiles, 0.12);
    });

    test('MISMATCHED is checked and flagged', () {
      final v = TripPathVerification.fromJson({'status': 'MISMATCHED', 'deviationMiles': 2.4});
      expect(v.isChecked, isTrue);
      expect(v.isMismatched, isTrue);
    });
  });
}
