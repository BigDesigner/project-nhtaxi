import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/models/directory_driver.dart';
import 'package:gnncab/models/driver_profile.dart';
import 'package:gnncab/models/rating.dart';

void main() {
  group('rating questions', () {
    test('there are five, and their keys match the API field names', () {
      expect(ratingQuestions, hasLength(5));
      expect(
        ratingQuestions.map((q) => q.key).toSet(),
        {'courtesy', 'safety', 'punctuality', 'communication', 'cleanliness'},
      );
    });
  });

  group('DriverReviews', () {
    test('parses a full summary with averages and comments', () {
      final r = DriverReviews.fromJson({
        'driverId': 'd1',
        'rating': 4.6,
        'ratingCount': 23,
        'averages': {
          'courtesy': 4.8,
          'safety': 5.0,
          'punctuality': 4.2,
          'communication': 4.5,
          'cleanliness': 4.5,
        },
        'recent': [
          {'overall': 5.0, 'comment': 'Great', 'createdAt': '2026-07-20T12:00:00.000Z'},
        ],
      });
      expect(r.rating, 4.6);
      expect(r.ratingCount, 23);
      expect(r.averages!['safety'], 5.0);
      expect(r.recent.single.comment, 'Great');
    });

    test('an unrated driver comes back with null rating and empty everything', () {
      final r = DriverReviews.fromJson({
        'driverId': 'd1',
        'rating': null,
        'ratingCount': 0,
        'averages': null,
        'recent': <dynamic>[],
      });
      expect(r.rating, isNull);
      expect(r.ratingCount, 0);
      expect(r.averages, isNull);
      expect(r.recent, isEmpty);
    });
  });

  group('rating on driver models', () {
    test('DirectoryDriver defaults to no rating when the fields are absent', () {
      final d = DirectoryDriver.fromJson({
        'driverId': 'd1',
        'firstName': 'Dan',
        'status': 'AVAILABLE',
      });
      expect(d.rating, isNull);
      expect(d.ratingCount, 0);
    });

    test('DirectoryDriver carries rating + count when present', () {
      final d = DirectoryDriver.fromJson({
        'driverId': 'd1',
        'firstName': 'Dan',
        'status': 'AVAILABLE',
        'rating': 4.3,
        'ratingCount': 12,
      });
      expect(d.rating, 4.3);
      expect(d.ratingCount, 12);
    });

    test('DriverProfile parses rating + count', () {
      final p = DriverProfile.fromJson({
        'id': 'dp1',
        'userId': 'u1',
        'email': 'dan@example.com',
        'firstName': 'Dan',
        'lastName': 'Driver',
        'status': 'AVAILABLE',
        'isVerified': true,
        'totalTrips': 40,
        'rating': 4.9,
        'ratingCount': 30,
      });
      expect(p.rating, 4.9);
      expect(p.ratingCount, 30);
    });
  });

  group('TripRating', () {
    test('parses a submitted rating', () {
      final r = TripRating.fromJson({
        'overall': 4.0,
        'courtesy': 5,
        'safety': 4,
        'punctuality': 3,
        'communication': 4,
        'cleanliness': 4,
        'comment': 'Solid',
      });
      expect(r.overall, 4.0);
      expect(r.courtesy, 5);
      expect(r.comment, 'Solid');
    });
  });
}
