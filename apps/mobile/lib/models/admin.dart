/// Admin-side models. Each mirrors a schema in packages/contract.
library;

import 'driver_document.dart';

/// A driver as the office sees them (GET /api/admin/drivers).
class AdminDriver {
  const AdminDriver({
    required this.id,
    required this.userId,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.status,
    required this.isVerified,
    required this.totalTrips,
    this.phone,
    this.vehicleMake,
    this.vehicleModel,
    this.vehiclePlate,
    this.rating,
  });

  final String id;
  final String userId;
  final String email;
  final String firstName;
  final String lastName;
  final String status;

  /// Until this is true the driver cannot go AVAILABLE, so no dispatch will
  /// ever reach them. It's the gate on the whole onboarding flow.
  final bool isVerified;

  final int totalTrips;
  final String? phone;
  final String? vehicleMake;
  final String? vehicleModel;
  final String? vehiclePlate;
  final double? rating;

  String get fullName => '$firstName $lastName';
  bool get isOnline => status != 'OFFLINE';

  String? get vehicleDescription {
    final parts = [vehicleMake, vehicleModel].where((p) => p != null && p.isNotEmpty);
    if (parts.isEmpty) return null;
    return [parts.join(' '), if (vehiclePlate != null) '· $vehiclePlate'].join(' ');
  }

  factory AdminDriver.fromJson(Map<String, dynamic> json) => AdminDriver(
        id: json['id'] as String,
        userId: json['userId'] as String,
        email: json['email'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        status: json['status'] as String,
        isVerified: json['isVerified'] as bool? ?? false,
        totalTrips: (json['totalTrips'] as num?)?.toInt() ?? 0,
        phone: json['phone'] as String?,
        vehicleMake: json['vehicleMake'] as String?,
        vehicleModel: json['vehicleModel'] as String?,
        vehiclePlate: json['vehiclePlate'] as String?,
        rating: (json['rating'] as num?)?.toDouble(),
      );
}

/// A driver plus their documents (GET /api/admin/drivers/{driverId}).
///
/// Separate from [AdminDriver] because the list endpoint deliberately omits
/// documents — fetching every driver's paperwork to render a list would be
/// wasteful, and it is only ever needed on one driver at a time.
class AdminDriverDetail {
  const AdminDriverDetail({required this.driver, required this.documents});

  final AdminDriver driver;
  final List<DriverDocument> documents;

  /// The office cannot honestly approve anyone whose licence and background
  /// check it has not looked at and approved.
  bool get hasAllRequiredApproved => requiredDocumentTypes
      .every((type) => documents.any((d) => d.type == type && d.isApproved));

  factory AdminDriverDetail.fromJson(Map<String, dynamic> json) => AdminDriverDetail(
        driver: AdminDriver.fromJson(json),
        documents: ((json['documents'] as List<dynamic>?) ?? const [])
            .map((e) => DriverDocument.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// One driver's line in the money report (GET /api/admin/reports/driver-balances).
class DriverBalanceRow {
  const DriverBalanceRow({
    required this.driverId,
    required this.driverName,
    required this.usageFeeCharged,
    required this.commissionCharged,
    required this.totalCharged,
    required this.totalCollected,
    required this.pendingBalance,
    required this.hasOpenSession,
  });

  final String driverId;
  final String driverName;
  final double usageFeeCharged;
  final double commissionCharged;
  final double totalCharged;
  final double totalCollected;

  /// What this driver still owes — the number that matters at hand-over.
  final double pendingBalance;

  final bool hasOpenSession;

  factory DriverBalanceRow.fromJson(Map<String, dynamic> json) => DriverBalanceRow(
        driverId: json['driverId'] as String,
        driverName: json['driverName'] as String? ?? 'Unknown',
        usageFeeCharged: (json['usageFeeCharged'] as num?)?.toDouble() ?? 0,
        commissionCharged: (json['commissionCharged'] as num?)?.toDouble() ?? 0,
        totalCharged: (json['totalCharged'] as num?)?.toDouble() ?? 0,
        totalCollected: (json['totalCollected'] as num?)?.toDouble() ?? 0,
        pendingBalance: (json['pendingBalance'] as num?)?.toDouble() ?? 0,
        hasOpenSession: json['hasOpenSession'] as bool? ?? false,
      );
}

/// A recorded cash hand-over (GET /api/admin/reports/driver-collections).
class CashCollection {
  const CashCollection({
    required this.id,
    required this.driverId,
    required this.driverName,
    required this.amount,
    required this.collectedAt,
    required this.collectedByName,
    this.notes,
  });

  final String id;
  final String driverId;
  final String driverName;
  final double amount;
  final DateTime collectedAt;
  final String collectedByName;
  final String? notes;

  factory CashCollection.fromJson(Map<String, dynamic> json) => CashCollection(
        id: json['id'] as String,
        driverId: json['driverId'] as String,
        driverName: json['driverName'] as String? ?? 'Unknown',
        amount: (json['amount'] as num).toDouble(),
        collectedAt: DateTime.parse(json['collectedAt'] as String),
        collectedByName: json['collectedByName'] as String? ?? 'Office',
        notes: json['notes'] as String?,
      );
}

/// The rate card (GET/PUT /api/admin/pricing). Dollars on the wire; the API
/// converts to and from the cents the database stores.
class PricingConfig {
  const PricingConfig({
    required this.id,
    required this.baseFare,
    required this.perMile,
    required this.driverUsagePerMinute,
    required this.driverCommissionPercent,
    required this.currency,
  });

  /// What the passenger pays.
  final double baseFare;
  final double perMile;

  /// What the driver owes GNN LLC — a separate business from the fare above.
  final double driverUsagePerMinute;
  final double driverCommissionPercent;

  final String id;
  final String currency;

  factory PricingConfig.fromJson(Map<String, dynamic> json) => PricingConfig(
        id: json['id'] as String,
        baseFare: (json['baseFare'] as num).toDouble(),
        perMile: (json['perMile'] as num).toDouble(),
        driverUsagePerMinute: (json['driverUsagePerMinute'] as num?)?.toDouble() ?? 0,
        driverCommissionPercent: (json['driverCommissionPercent'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? 'USD',
      );
}

/// A trip row in the office's monitor (GET /api/admin/reports/trips).
class AdminTripRow {
  const AdminTripRow({
    required this.tripId,
    required this.status,
    required this.requestedAt,
    required this.customerName,
    required this.currency,
    required this.referralSource,
    this.completedAt,
    this.driverId,
    this.driverName,
    this.distanceMiles,
    this.estimatedFare,
    this.finalFare,
  });

  final String tripId;
  final String status;
  final DateTime requestedAt;
  final DateTime? completedAt;
  final String? driverId;
  final String? driverName;
  final String customerName;

  /// Whether GNN LLC referred this job, and so whether it owes commission.
  final String referralSource;

  bool get isReferred => referralSource != 'NONE';
  final double? distanceMiles;
  final double? estimatedFare;
  final double? finalFare;
  final String currency;

  double? get displayFare => finalFare ?? estimatedFare;

  /// Still needs watching — everything else is history.
  bool get isLive => !const {'TRIP_COMPLETED', 'TRIP_CANCELLED', 'TIMEOUT'}.contains(status);

  /// Nobody has picked it up and the search may have given up.
  bool get needsAttention => const {'TIMEOUT', 'DRIVER_NO_RESPONSE'}.contains(status);

  factory AdminTripRow.fromJson(Map<String, dynamic> json) => AdminTripRow(
        tripId: json['tripId'] as String,
        status: json['status'] as String,
        requestedAt: DateTime.parse(json['requestedAt'] as String),
        completedAt: json['completedAt'] == null ? null : DateTime.parse(json['completedAt'] as String),
        driverId: json['driverId'] as String?,
        driverName: json['driverName'] as String?,
        customerName: json['customerName'] as String? ?? 'Guest',
        referralSource: json['referralSource'] as String? ?? 'NONE',
        distanceMiles: (json['distanceMiles'] as num?)?.toDouble(),
        estimatedFare: (json['estimatedFare'] as num?)?.toDouble(),
        finalFare: (json['finalFare'] as num?)?.toDouble(),
        currency: json['currency'] as String? ?? 'USD',
      );
}

/// A user row in the office's people list (GET /api/admin/users).
class AdminUser {
  const AdminUser({
    required this.id,
    required this.email,
    required this.firstName,
    required this.lastName,
    required this.role,
    required this.isActive,
    required this.createdAt,
    this.phone,
  });

  final String id;
  final String email;
  final String firstName;
  final String lastName;

  /// admin / driver / customer
  final String role;

  /// A deactivated account can still sign in nowhere — login returns 403.
  final bool isActive;

  final DateTime createdAt;
  final String? phone;

  String get fullName => '$firstName $lastName';

  factory AdminUser.fromJson(Map<String, dynamic> json) => AdminUser(
        id: json['id'] as String,
        email: json['email'] as String,
        firstName: json['firstName'] as String,
        lastName: json['lastName'] as String,
        role: json['role'] as String,
        isActive: json['isActive'] as bool? ?? true,
        createdAt: DateTime.parse(json['createdAt'] as String),
        phone: json['phone'] as String?,
      );
}

/// One line of the audit trail (GET /api/admin/audit-logs).
///
/// Everything money- or status-changing writes one of these. They were being
/// recorded from the very first phase and had no way to be read until now,
/// which made them useless exactly when they would matter — in a dispute.
class AuditEntry {
  const AuditEntry({
    required this.id,
    required this.entity,
    required this.action,
    required this.createdAt,
    this.entityId,
    this.actorId,
    this.actorRole,
    this.metadata,
    this.ipAddress,
  });

  final String id;
  final String entity;
  final String action;
  final DateTime createdAt;
  final String? entityId;
  final String? actorId;
  final String? actorRole;
  final Map<String, dynamic>? metadata;
  final String? ipAddress;

  /// Turns TRIP_REFERRAL_CHANGED into "Trip referral changed" rather than
  /// making the office read database constants.
  String get actionLabel {
    final words = action.toLowerCase().split('_');
    if (words.isEmpty) return action;
    return words.first[0].toUpperCase() + words.first.substring(1) + (words.length > 1 ? ' ${words.skip(1).join(' ')}' : '');
  }

  /// The entries worth noticing: money moving, or someone's ability to work
  /// changing.
  bool get isSignificant => const {
        'TRIP_REFERRAL_CHANGED',
        'DRIVER_VERIFIED',
        'DRIVER_UNVERIFIED',
        'CASH_COLLECTED',
        'PRICING_UPDATED',
        'COMMISSION_CHARGED',
        'PASSWORD_CHANGED',
        'USER_ROLE_CHANGED',
      }.contains(action);

  factory AuditEntry.fromJson(Map<String, dynamic> json) => AuditEntry(
        id: json['id'] as String,
        entity: json['entity'] as String,
        action: json['action'] as String,
        createdAt: DateTime.parse(json['createdAt'] as String),
        entityId: json['entityId'] as String?,
        actorId: json['actorId'] as String?,
        actorRole: json['actorRole'] as String?,
        metadata: json['metadata'] as Map<String, dynamic>?,
        ipAddress: json['ipAddress'] as String?,
      );
}

/// One commission GNN LLC charged on a referred job
/// (GET /api/admin/reports/driver-commissions).
///
/// The Money tab shows totals; this is the line-by-line behind them, which is
/// what a driver disputing a figure actually needs to see.
class CommissionCharge {
  const CommissionCharge({
    required this.id,
    required this.driverId,
    required this.driverName,
    required this.tripId,
    required this.fare,
    required this.commissionPercent,
    required this.commission,
    required this.createdAt,
  });

  final String id;
  final String driverId;
  final String driverName;
  final String tripId;
  final double fare;
  final double commissionPercent;
  final double commission;
  final DateTime createdAt;

  factory CommissionCharge.fromJson(Map<String, dynamic> json) => CommissionCharge(
        id: json['id'] as String,
        driverId: json['driverId'] as String,
        driverName: json['driverName'] as String? ?? 'Unknown',
        tripId: json['tripId'] as String,
        fare: (json['fare'] as num?)?.toDouble() ?? 0,
        commissionPercent: (json['commissionPercent'] as num?)?.toDouble() ?? 0,
        commission: (json['commission'] as num?)?.toDouble() ?? 0,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

/// One driver's completed-fare total (GET /api/admin/reports/driver-earnings).
/// This is the driver's own turnover — what passengers paid them — which the
/// office can hand a driver for their tax record.
class AdminDriverEarningsRow {
  const AdminDriverEarningsRow({
    required this.driverId,
    required this.driverName,
    required this.tripCount,
    required this.totalEarnings,
    required this.currency,
  });

  final String driverId;
  final String driverName;
  final int tripCount;
  final double totalEarnings;
  final String currency;

  factory AdminDriverEarningsRow.fromJson(Map<String, dynamic> json) => AdminDriverEarningsRow(
        driverId: json['driverId'] as String,
        driverName: json['driverName'] as String? ?? 'Unknown',
        tripCount: (json['tripCount'] as num?)?.toInt() ?? 0,
        totalEarnings: (json['totalEarnings'] as num?)?.toDouble() ?? 0,
        currency: json['currency'] as String? ?? 'USD',
      );
}

/// A single driver's contribution to a period's financial summary.
class FinancialSummaryRow {
  const FinancialSummaryRow({
    required this.driverId,
    required this.driverName,
    required this.usageFeesCharged,
    required this.commissionCharged,
    required this.gnnRevenue,
    required this.cashCollected,
    required this.completedTripCount,
    required this.grossFares,
  });

  final String driverId;
  final String driverName;
  final double usageFeesCharged;
  final double commissionCharged;

  /// GNN LLC's own income from this driver: rent + commission.
  final double gnnRevenue;
  final double cashCollected;
  final int completedTripCount;

  /// The driver's turnover (passenger-paid fares) — informational, not GNN's.
  final double grossFares;

  factory FinancialSummaryRow.fromJson(Map<String, dynamic> json) => FinancialSummaryRow(
        driverId: json['driverId'] as String,
        driverName: json['driverName'] as String? ?? 'Unknown',
        usageFeesCharged: (json['usageFeesCharged'] as num?)?.toDouble() ?? 0,
        commissionCharged: (json['commissionCharged'] as num?)?.toDouble() ?? 0,
        gnnRevenue: (json['gnnRevenue'] as num?)?.toDouble() ?? 0,
        cashCollected: (json['cashCollected'] as num?)?.toDouble() ?? 0,
        completedTripCount: (json['completedTripCount'] as num?)?.toInt() ?? 0,
        grossFares: (json['grossFares'] as num?)?.toDouble() ?? 0,
      );
}

/// Period totals for tax filing (GET /api/admin/reports/financial-summary).
/// GNN LLC's income (rent + commission) is kept apart from the gross fares,
/// which belong to the drivers, not GNN.
class FinancialSummary {
  const FinancialSummary({
    required this.from,
    required this.to,
    required this.currency,
    required this.usageFeesCharged,
    required this.commissionCharged,
    required this.gnnGrossRevenue,
    required this.cashCollected,
    required this.completedTripCount,
    required this.grossFares,
    required this.drivers,
  });

  final DateTime? from;
  final DateTime? to;
  final String currency;
  final double usageFeesCharged;
  final double commissionCharged;

  /// The headline for GNN's books: usage fees + commission over the period.
  final double gnnGrossRevenue;
  final double cashCollected;
  final int completedTripCount;
  final double grossFares;
  final List<FinancialSummaryRow> drivers;

  factory FinancialSummary.fromJson(Map<String, dynamic> json) => FinancialSummary(
        from: json['from'] == null ? null : DateTime.parse(json['from'] as String),
        to: json['to'] == null ? null : DateTime.parse(json['to'] as String),
        currency: json['currency'] as String? ?? 'USD',
        usageFeesCharged: (json['usageFeesCharged'] as num?)?.toDouble() ?? 0,
        commissionCharged: (json['commissionCharged'] as num?)?.toDouble() ?? 0,
        gnnGrossRevenue: (json['gnnGrossRevenue'] as num?)?.toDouble() ?? 0,
        cashCollected: (json['cashCollected'] as num?)?.toDouble() ?? 0,
        completedTripCount: (json['completedTripCount'] as num?)?.toInt() ?? 0,
        grossFares: (json['grossFares'] as num?)?.toDouble() ?? 0,
        drivers: ((json['drivers'] as List<dynamic>?) ?? [])
            .map((e) => FinancialSummaryRow.fromJson(e as Map<String, dynamic>))
            .toList(),
      );
}

/// A place the business serves (GET/POST /api/admin/cities).
class City {
  const City({
    required this.id,
    required this.name,
    required this.country,
    required this.timezone,
    required this.isActive,
    this.state,
  });

  final String id;
  final String name;
  final String country;
  final String timezone;
  final bool isActive;
  final String? state;

  String get label => [name, ?state].join(', ');

  factory City.fromJson(Map<String, dynamic> json) => City(
        id: json['id'] as String,
        name: json['name'] as String,
        country: json['country'] as String? ?? 'US',
        timezone: json['timezone'] as String? ?? 'America/New_York',
        isActive: json['isActive'] as bool? ?? true,
        state: json['state'] as String?,
      );
}
