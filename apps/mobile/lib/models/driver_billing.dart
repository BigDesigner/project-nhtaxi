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

  /// A cut of the fare on trips an admin hand-assigned.
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
