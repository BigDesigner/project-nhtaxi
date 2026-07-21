import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/providers.dart';
import '../../../models/rating.dart';

/// Whether a trip has been rated yet, and the rating if so. Drives the
/// active-trip screen's choice between a "rate this" prompt and a read-only
/// summary. autoDispose so it doesn't outlive the screen showing it.
final tripRatingProvider = FutureProvider.autoDispose.family<TripRating?, String>((ref, tripId) async {
  final json = await ref.read(apiClientProvider).get('/api/trips/$tripId/rating');
  final rated = json['rated'] as bool? ?? false;
  if (!rated || json['rating'] == null) return null;
  return TripRating.fromJson(json['rating'] as Map<String, dynamic>);
});

/// A driver's public rating summary + recent comments, for the passenger who
/// taps a driver.
final driverReviewsProvider = FutureProvider.autoDispose.family<DriverReviews, String>((ref, driverId) async {
  final json = await ref.read(apiClientProvider).get('/api/drivers/$driverId/reviews');
  return DriverReviews.fromJson(json);
});

/// Submits a rating. Returns the created rating so the caller can flip
/// straight to the summary without a refetch, and invalidates the status
/// provider so any other screen watching this trip updates too.
Future<TripRating> submitRating(
  WidgetRef ref,
  String tripId, {
  required Map<String, int> stars,
  String? comment,
}) async {
  final json = await ref.read(apiClientProvider).post(
    '/api/trips/$tripId/rating',
    body: {...stars, if (comment != null && comment.isNotEmpty) 'comment': comment},
  );
  ref.invalidate(tripRatingProvider(tripId));
  return TripRating.fromJson(json);
}
