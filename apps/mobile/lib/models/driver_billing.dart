/// What a driver owes GNN LLC, and how it was run up.
///
/// Mirrors DriverOwnBalanceSchema (GET /api/driver/balance). All amounts are
/// dollars, not cents — the API divides before serialising.
class DriverBalance {
  const DriverBalance({
    required this.usageFeeCharged,
    required this.commissionCharged,
    required this.totalCharged,
    required this.totalCollected,
    required this.pendingBalance,
    required this.hasOpenSession,
  });

  /// Charged per minute of being online, whether or not any trip happened.
  final double usageFeeCharged;

  /// A cut of the fare on jobs GNN LLC referred — whether the office assigned
  /// them in the panel, the driver ticked the referral box on accept, or the
  /// office marked it after the fact. Ordinary dispatch work carries none.
  final double commissionCharged;

  final double totalCharged;

  /// Cash already handed over and recorded by an admin.
  final double totalCollected;

  /// The outstanding figure — what to bring to the next cash hand-over.
  final double pendingBalance;

  /// A session is running right now, so [pendingBalance] is still climbing.
  final bool hasOpenSession;

  factory DriverBalance.fromJson(Map<String, dynamic> json) => DriverBalance(
        usageFeeCharged: (json['usageFeeCharged'] as num?)?.toDouble() ?? 0,
        commissionCharged: (json['commissionCharged'] as num?)?.toDouble() ?? 0,
        totalCharged: (json['totalCharged'] as num?)?.toDouble() ?? 0,
        totalCollected: (json['totalCollected'] as num?)?.toDouble() ?? 0,
        pendingBalance: (json['pendingBalance'] as num?)?.toDouble() ?? 0,
        hasOpenSession: json['hasOpenSession'] as bool? ?? false,
      );
}

/// One stretch of being online. Mirrors DriverSessionSchema
/// (GET /api/driver/sessions) — the "which days and hours did I work" record.
class DriverSession {
  const DriverSession({
    required this.id,
    required this.startedAt,
    this.endedAt,
    this.durationMinutes,
    this.charge,
    this.closedReason,
  });

  final String id;
  final DateTime startedAt;

  /// Null while the session is still open.
  final DateTime? endedAt;

  final int? durationMinutes;

  /// What this stretch cost the driver in usage fees.
  final double? charge;

  /// OFFLINE_TOGGLE / STALE_TIMEOUT / ADMIN_FORCE_CLOSE.
  final String? closedReason;

  bool get isOpen => endedAt == null;

  /// Worth surfacing: a session the server had to close because the app went
  /// quiet still cost money, and the driver should know that's why.
  bool get wasTimedOut => closedReason == 'STALE_TIMEOUT';

  String get closedReasonLabel => switch (closedReason) {
        'OFFLINE_TOGGLE' => 'You went offline',
        'STALE_TIMEOUT' => 'App stopped responding — closed automatically',
        'ADMIN_FORCE_CLOSE' => 'Closed by the office',
        _ => '',
      };

  factory DriverSession.fromJson(Map<String, dynamic> json) => DriverSession(
        id: json['id'] as String,
        startedAt: DateTime.parse(json['startedAt'] as String),
        endedAt: json['endedAt'] == null ? null : DateTime.parse(json['endedAt'] as String),
        durationMinutes: (json['durationMinutes'] as num?)?.toInt(),
        charge: (json['charge'] as num?)?.toDouble(),
        closedReason: json['closedReason'] as String?,
      );
}

/// What the driver has actually earned (GET /api/driver/earnings).
///
/// The counterpart to [DriverBalance]. Drivers could see what they owe but
/// never what they took, which is a strange half of the picture to be shown —
/// especially when the money they earn never passes through this system at
/// all and this is the only record of it.
class DriverEarnings {
  const DriverEarnings({
    required this.tripCount,
    required this.totalEarnings,
    required this.currency,
    required this.trips,
  });

  final int tripCount;
  final double totalEarnings;
  final String currency;
  final List<EarnedTrip> trips;

  factory DriverEarnings.fromJson(Map<String, dynamic> json) => DriverEarnings(
        tripCount: (json['tripCount'] as num?)?.toInt() ?? 0,
        totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? 'USD',
        trips: ((json['trips'] as List<dynamic>?) ?? const [])
            .map((e) => EarnedTrip.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

class EarnedTrip {
  const EarnedTrip({
    required this.tripId,
    required this.currency,
    this.completedAt,
    this.distanceMiles,
    this.fare,
  });

  final String tripId;
  final String currency;
  final DateTime? completedAt;
  final double? distanceMiles;
  final double? fare;

  factory EarnedTrip.fromJson(Map<String, dynamic> json) => EarnedTrip(
        tripId: json['tripId'] as String,
        currency: json['currency'] as String? ?? 'USD',
        completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
        distanceMiles: (json['distanceMiles'] as num?)?.toDouble(),
        fare: (json['fare'] as num?)?.toDouble(),
      );
}
