import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/models/admin.dart';
import 'package:gnncab/models/driver_document.dart';

Map<String, dynamic> doc({
  String id = 'd1',
  String type = 'license',
  String status = 'PENDING',
  String uploadedAt = '2026-07-20T10:00:00.000Z',
}) => {
      'id': id,
      'type': type,
      'status': status,
      'uploadedAt': uploadedAt,
      'reviewedAt': null,
    };

Map<String, dynamic> driverJson(List<Map<String, dynamic>> documents) => {
      'id': 'dp1',
      'userId': 'u1',
      'email': 'dan@example.com',
      'firstName': 'Dan',
      'lastName': 'Driver',
      'status': 'OFFLINE',
      'isVerified': false,
      'totalTrips': 0,
      'documents': documents,
    };

void main() {
  group('DriverDocument', () {
    test('parses the wire shape', () {
      final d = DriverDocument.fromJson(doc());
      expect(d.type, 'license');
      expect(d.isPending, isTrue);
      expect(d.typeLabel, "Driver's licence");
    });

    test('every required type has a human label', () {
      // A raw enum name leaking into the UI means a type was added without
      // being given wording.
      for (final type in requiredDocumentTypes) {
        final label = DriverDocument.fromJson(doc(type: type)).typeLabel;
        expect(label, isNot(equals(type)), reason: type);
      }
    });

    test('status is exactly one of pending/approved/rejected', () {
      expect(DriverDocument.fromJson(doc(status: 'APPROVED')).isApproved, isTrue);
      expect(DriverDocument.fromJson(doc(status: 'REJECTED')).isRejected, isTrue);
      expect(DriverDocument.fromJson(doc(status: 'PENDING')).isPending, isTrue);
    });
  });

  group('AdminDriverDetail', () {
    test('parses the driver and their documents from one response', () {
      final detail = AdminDriverDetail.fromJson(driverJson([doc()]));
      expect(detail.driver.fullName, 'Dan Driver');
      expect(detail.documents, hasLength(1));
    });

    test('is not ready to approve until every required document is approved', () {
      // This drives the warning above the Approve button. Approving grants
      // someone the right to carry passengers, so "some paperwork exists"
      // must not read as "the paperwork is done".
      final none = AdminDriverDetail.fromJson(driverJson([]));
      expect(none.hasAllRequiredApproved, isFalse);

      final uploadedNotReviewed = AdminDriverDetail.fromJson(driverJson([
        doc(type: 'license'),
        doc(type: 'background_check', id: 'd2'),
      ]));
      expect(uploadedNotReviewed.hasAllRequiredApproved, isFalse);

      final onlyOneApproved = AdminDriverDetail.fromJson(driverJson([
        doc(type: 'license', status: 'APPROVED'),
        doc(type: 'background_check', id: 'd2', status: 'PENDING'),
      ]));
      expect(onlyOneApproved.hasAllRequiredApproved, isFalse);

      final rejected = AdminDriverDetail.fromJson(driverJson([
        doc(type: 'license', status: 'APPROVED'),
        doc(type: 'background_check', id: 'd2', status: 'REJECTED'),
      ]));
      expect(rejected.hasAllRequiredApproved, isFalse);

      final ready = AdminDriverDetail.fromJson(driverJson([
        doc(type: 'license', status: 'APPROVED'),
        doc(type: 'background_check', id: 'd2', status: 'APPROVED'),
      ]));
      expect(ready.hasAllRequiredApproved, isTrue);
    });

    test('a profile photo does not count towards eligibility', () {
      // Only the licence and background check gate driving under RSA 376-A.
      final photoOnly = AdminDriverDetail.fromJson(driverJson([
        doc(type: 'photo', status: 'APPROVED'),
      ]));
      expect(photoOnly.hasAllRequiredApproved, isFalse);
    });

    test('copes with a driver who has uploaded nothing', () {
      final detail = AdminDriverDetail.fromJson({...driverJson([])}..remove('documents'));
      expect(detail.documents, isEmpty);
      expect(detail.hasAllRequiredApproved, isFalse);
    });
  });
}
