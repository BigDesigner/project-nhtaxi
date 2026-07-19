/// Mirrors EstimateTripResponseSchema (POST /api/trips/estimate).
class FareEstimate {
  const FareEstimate({
    required this.distanceMiles,
    required this.estimatedFare,
    required this.currency,
  });

  final double distanceMiles;
  final double estimatedFare;
  final String currency;

  factory FareEstimate.fromJson(Map<String, dynamic> json) => FareEstimate(
        distanceMiles: (json['distanceMiles'] as num).toDouble(),
        estimatedFare: (json['estimatedFare'] as num).toDouble(),
        currency: json['currency'] as String? ?? 'USD',
      );
}
