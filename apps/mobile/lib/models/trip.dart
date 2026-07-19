/// Mirrors TripResponseSchema in packages/contract.
///
/// Only the fields the passenger UI actually uses are modelled — the wire
/// response carries more (commission, guest details, city) that belongs to
/// the admin/driver surfaces.
class Trip {
  const Trip({
    required this.id,
    required this.status,
    required this.pickupAddress,
    required this.requestedAt,
    this.dropoffAddress,
    this.distanceMiles,
    this.estimatedFare,
    this.finalFare,
    required this.currency,
    this.completedAt,
    this.searchAttempts = 0,
    this.nextSearchAt,
    this.maxSearchAttempts = 0,
  });

  final String id;
  final String status;
  final String pickupAddress;

  /// Null until a driver fills it in at pickup, for admin-assigned trips.
  final String? dropoffAddress;

  final double? distanceMiles;
  final double? estimatedFare;
  final double? finalFare;
  final String currency;
  final DateTime requestedAt;
  final DateTime? completedAt;

  /// Driver-search progress, driven entirely by the server's Alarm loop. The
  /// UI counts down to [nextSearchAt] rather than running its own timer, so
  /// every screen showing this trip agrees on the number.
  final int searchAttempts;
  final DateTime? nextSearchAt;
  final int maxSearchAttempts;

  /// Still looking for a driver — no one has taken it yet.
  bool get isSearching => status == 'REQUESTED' || status == 'DRIVER_NO_RESPONSE' || status == 'DRIVER_REJECTED';

  /// The search budget ran out; the passenger can restart it.
  bool get canRetrySearch => status == 'TIMEOUT';

  /// Mirrors the API's rule: once the ride is under way or finished, calling
  /// it off is a phone call, not a button. A timed-out trip stays cancellable
  /// so it can be cleared out instead of lingering.
  bool get canCancel => !const {'TRIP_STARTED', 'TRIP_COMPLETED', 'TRIP_CANCELLED'}.contains(status);

  /// A driver is on this trip.
  bool get isMatched => const {
        'DRIVER_ASSIGNED',
        'DRIVER_ACCEPTED',
        'DRIVER_EN_ROUTE',
        'DRIVER_ARRIVED',
        'TRIP_STARTED',
      }.contains(status);

  bool get isCancelled => status == 'TRIP_CANCELLED';

  /// What the passenger was actually charged, falling back to the quote
  /// while the trip is still in flight.
  double? get displayFare => finalFare ?? estimatedFare;

  bool get isActive => !const {
        'TRIP_COMPLETED',
        'TRIP_CANCELLED',
        'TIMEOUT',
      }.contains(status);

  /// Human-readable form of the 11-state machine (see plan §4.2).
  String get statusLabel => switch (status) {
        'REQUESTED' => 'Looking for a driver',
        'DRIVER_ASSIGNED' => 'Driver assigned',
        'DRIVER_ACCEPTED' => 'Driver accepted',
        'DRIVER_EN_ROUTE' => 'Driver on the way',
        'DRIVER_ARRIVED' => 'Driver has arrived',
        'TRIP_STARTED' => 'On the way',
        'TRIP_COMPLETED' => 'Completed',
        'TRIP_CANCELLED' => 'Cancelled',
        'DRIVER_REJECTED' => 'Finding another driver',
        'DRIVER_NO_RESPONSE' => 'Finding another driver',
        'TIMEOUT' => 'No driver available',
        _ => status,
      };

  factory Trip.fromJson(Map<String, dynamic> json) => Trip(
        id: json['id'] as String,
        status: json['status'] as String,
        pickupAddress: json['pickupAddress'] as String,
        dropoffAddress: json['dropoffAddress'] as String?,
        distanceMiles: (json['distanceMiles'] as num?)?.toDouble(),
        estimatedFare: (json['estimatedFare'] as num?)?.toDouble(),
        finalFare: (json['finalFare'] as num?)?.toDouble(),
        currency: json['currency'] as String? ?? 'USD',
        requestedAt: DateTime.parse(json['requestedAt'] as String),
        completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
        searchAttempts: (json['searchAttempts'] as num?)?.toInt() ?? 0,
        nextSearchAt: json['nextSearchAt'] == null ? null : DateTime.parse(json['nextSearchAt'] as String),
        maxSearchAttempts: (json['maxSearchAttempts'] as num?)?.toInt() ?? 0,
      );
}
