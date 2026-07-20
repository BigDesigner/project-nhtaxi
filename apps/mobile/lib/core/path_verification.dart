import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'providers.dart';

/// Whether the car's own recorded path actually reached this trip's booked
/// pickup and dropoff — computed server-side at completion
/// (`apps/api/src/lib/path-verification.ts`), anchored on the trip's own
/// endpoints rather than anything a passenger's phone reported.
///
/// Driver/admin-only. `GET /api/trips/{tripId}/path-verification` is the one
/// place this is exposed — never on the trip itself — precisely so a
/// passenger-facing screen can't leak it by accident.
class TripPathVerification {
  const TripPathVerification({required this.status, this.deviationMiles});

  final String status; // NOT_CHECKED | MATCHED | MISMATCHED
  final double? deviationMiles;

  bool get isMismatched => status == 'MISMATCHED';

  /// Nothing to say — either the trip hasn't completed yet, or no
  /// breadcrumbs exist to check it against (a dead phone, or a trip from
  /// before this existed). Silence, not an accusation.
  bool get isChecked => status != 'NOT_CHECKED';

  factory TripPathVerification.fromJson(Map<String, dynamic> json) => TripPathVerification(
        status: json['status'] as String,
        deviationMiles: (json['deviationMiles'] as num?)?.toDouble(),
      );
}

/// A 403 here just means the viewer isn't the assigned driver or an admin —
/// not an error worth surfacing, so this quietly resolves to null instead of
/// putting the screen into an error state for a check nobody but the office
/// needed to see anyway.
final tripPathVerificationProvider = FutureProvider.autoDispose.family<TripPathVerification?, String>((ref, tripId) async {
  try {
    final json = await ref.read(apiClientProvider).get('/api/trips/$tripId/path-verification');
    return TripPathVerification.fromJson(json);
  } catch (_) {
    return null;
  }
});
