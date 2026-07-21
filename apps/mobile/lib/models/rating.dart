/// The five questions a passenger answers, each 1–5 stars. The order here is
/// the order they're shown; the keys match the API's field names.
class RatingQuestion {
  const RatingQuestion(this.key, this.prompt);

  final String key;
  final String prompt;
}

const ratingQuestions = [
  RatingQuestion('courtesy', 'Was your driver courteous?'),
  RatingQuestion('safety', 'Did your driver drive safely?'),
  RatingQuestion('punctuality', 'Did your driver pick you up on time?'),
  RatingQuestion('communication', 'Did your driver keep you informed?'),
  RatingQuestion('cleanliness', 'Was the vehicle clean?'),
];

/// One submitted rating, read back from the API.
class TripRating {
  const TripRating({
    required this.overall,
    required this.courtesy,
    required this.safety,
    required this.punctuality,
    required this.communication,
    required this.cleanliness,
    this.comment,
  });

  final double overall;
  final int courtesy;
  final int safety;
  final int punctuality;
  final int communication;
  final int cleanliness;
  final String? comment;

  factory TripRating.fromJson(Map<String, dynamic> json) => TripRating(
        overall: (json['overall'] as num).toDouble(),
        courtesy: (json['courtesy'] as num).toInt(),
        safety: (json['safety'] as num).toInt(),
        punctuality: (json['punctuality'] as num).toInt(),
        communication: (json['communication'] as num).toInt(),
        cleanliness: (json['cleanliness'] as num).toInt(),
        comment: json['comment'] as String?,
      );
}

/// A single comment in a driver's review list — no reviewer identity, by
/// design (the API never sends it).
class DriverReview {
  const DriverReview({required this.overall, required this.createdAt, this.comment});

  final double overall;
  final DateTime createdAt;
  final String? comment;

  factory DriverReview.fromJson(Map<String, dynamic> json) => DriverReview(
        overall: (json['overall'] as num).toDouble(),
        createdAt: DateTime.parse(json['createdAt'] as String),
        comment: json['comment'] as String?,
      );
}

/// A driver's public rating summary: headline average, count, per-question
/// averages, and recent comments.
class DriverReviews {
  const DriverReviews({
    required this.rating,
    required this.ratingCount,
    required this.averages,
    required this.recent,
  });

  final double? rating;
  final int ratingCount;

  /// Per-question averages, keyed by question key. Null until at least one
  /// rating exists.
  final Map<String, double>? averages;
  final List<DriverReview> recent;

  factory DriverReviews.fromJson(Map<String, dynamic> json) {
    final rawAverages = json['averages'] as Map<String, dynamic>?;
    return DriverReviews(
      rating: (json['rating'] as num?)?.toDouble(),
      ratingCount: (json['ratingCount'] as num?)?.toInt() ?? 0,
      averages: rawAverages?.map((k, v) => MapEntry(k, (v as num?)?.toDouble() ?? 0)),
      recent: ((json['recent'] as List<dynamic>?) ?? const [])
          .map((e) => DriverReview.fromJson(e as Map<String, dynamic>))
          .toList(),
    );
  }
}
