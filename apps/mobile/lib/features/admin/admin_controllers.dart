import 'dart:typed_data';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/admin.dart';
import '../../models/driver_billing.dart';
import '../../models/trip.dart';

/// Everything the office reads and writes.
///
/// Kept as plain providers rather than notifiers where nothing mutates: the
/// admin surface is mostly reports, and `ref.invalidate` after a write is
/// simpler to follow than hand-rolled state updates.

final adminDriversProvider = FutureProvider<List<AdminDriver>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/drivers');
  return raw.map((e) => AdminDriver.fromJson(e as Map<String, dynamic>)).toList();
});

/// Verifying is the gate on a driver ever receiving work, so it invalidates
/// the list rather than patching one row — a stale "unverified" badge here
/// would have someone chasing a problem that no longer exists.
Future<void> setDriverVerified(WidgetRef ref, String driverId, bool verified) async {
  await ref.read(apiClientProvider).put(
        '/api/admin/drivers/$driverId/verify',
        body: {'isVerified': verified},
      );
  ref.invalidate(adminDriversProvider);
}

/// One driver in full, *including their documents*.
///
/// The list endpoint doesn't carry documents, so a screen built off the list
/// alone can never show them — which is exactly why Approve was a blind
/// action for so long.
final adminDriverDetailProvider =
    FutureProvider.family<AdminDriverDetail, String>((ref, driverId) async {
  final json = await ref.read(apiClientProvider).get('/api/admin/drivers/$driverId');
  return AdminDriverDetail.fromJson(json);
});

/// Approves or rejects one document. Write-once server-side: an approved
/// document can't be changed again, so the UI stops offering it.
Future<void> reviewDriverDocument(
  WidgetRef ref,
  String driverId,
  String documentId,
  bool approve,
) async {
  await ref.read(apiClientProvider).put(
        '/api/admin/drivers/$driverId/documents/$documentId',
        body: {'status': approve ? 'APPROVED' : 'REJECTED'},
      );
  ref.invalidate(adminDriverDetailProvider(driverId));
}

/// The decrypted bytes of one document, for the office to actually look at.
/// Fetched through the API client because the route is admin-authenticated
/// and `NetworkImage` can't carry a Bearer token on the web build.
final driverDocumentFileProvider =
    FutureProvider.family<Uint8List, ({String driverId, String documentId})>((ref, key) async {
  return ref.read(apiClientProvider).getBytes(
        '/api/admin/drivers/${key.driverId}/documents/${key.documentId}/file',
      );
});

final driverBalancesProvider = FutureProvider<List<DriverBalanceRow>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/reports/driver-balances');
  return raw.map((e) => DriverBalanceRow.fromJson(e as Map<String, dynamic>)).toList();
});

final cashCollectionsProvider = FutureProvider<List<CashCollection>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/reports/driver-collections');
  return raw.map((e) => CashCollection.fromJson(e as Map<String, dynamic>)).toList();
});

/// A reporting period. Null bounds mean open-ended; used as the family key for
/// the period-scoped reports so each range is cached separately.
typedef ReportPeriod = ({DateTime? from, DateTime? to});

Map<String, dynamic>? _periodQuery(ReportPeriod p) {
  final q = <String, dynamic>{};
  if (p.from != null) q['from'] = p.from!.toUtc().toIso8601String();
  if (p.to != null) q['to'] = p.to!.toUtc().toIso8601String();
  return q.isEmpty ? null : q;
}

/// Period financial summary — GNN income (rent + commission), cash collected,
/// and gross fares. The backbone of the tax-filing export.
final financialSummaryProvider =
    FutureProvider.family<FinancialSummary, ReportPeriod>((ref, period) async {
  final raw = await ref
      .read(apiClientProvider)
      .get('/api/admin/reports/financial-summary', query: _periodQuery(period));
  return FinancialSummary.fromJson(raw);
});

/// Completed-fare earnings per driver — the drivers' own turnover, for handing
/// a driver their figure or running the whole fleet.
final adminDriverEarningsProvider =
    FutureProvider.family<List<AdminDriverEarningsRow>, ReportPeriod>((ref, period) async {
  final raw = await ref
      .read(apiClientProvider)
      .getList('/api/admin/reports/driver-earnings', query: _periodQuery(period));
  return raw.map((e) => AdminDriverEarningsRow.fromJson(e as Map<String, dynamic>)).toList();
});

/// Per-trip fare detail (passenger, driver, route, charge) for the period —
/// the line-item backing for the summary, and the fullest tax export.
final tripFareReportProvider =
    FutureProvider.family<List<TripReportRow>, ReportPeriod>((ref, period) async {
  final query = {...?_periodQuery(period), 'limit': '500'};
  final raw = await ref.read(apiClientProvider).getList('/api/admin/reports/trips', query: query);
  return raw.map((e) => TripReportRow.fromJson(e as Map<String, dynamic>)).toList();
});

/// Looks a trip up by full id or short prefix (the office "what's your trip
/// ID?" flow). Empty query short-circuits to no results without a call.
final adminTripLookupProvider = FutureProvider.family<List<Trip>, String>((ref, query) async {
  final q = query.trim();
  if (q.isEmpty) return const [];
  final raw = await ref.read(apiClientProvider).getList('/api/admin/trips/lookup', query: {'q': q});
  return raw.map((e) => Trip.fromJson(e as Map<String, dynamic>)).toList();
});

/// Records cash a driver has physically handed over.
///
/// This is the only way a balance ever goes down, so it invalidates both the
/// report and the collections log — an admin who records a payment and still
/// sees the old outstanding figure will record it twice.
Future<void> recordCashCollection(
  WidgetRef ref,
  String driverId, {
  required double amount,
  String? notes,
}) async {
  await ref.read(apiClientProvider).post(
    '/api/admin/drivers/$driverId/collections',
    body: {'amount': amount, if (notes != null && notes.isNotEmpty) 'notes': notes},
  );
  ref.invalidate(driverBalancesProvider);
  ref.invalidate(cashCollectionsProvider);
}

/// One driver's online-session history, for answering "why do I owe this?".
final adminDriverSessionsProvider =
    FutureProvider.family<List<DriverSession>, String>((ref, driverId) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/drivers/$driverId/sessions');
  return raw.map((e) => DriverSession.fromJson(e as Map<String, dynamic>)).toList();
});

/// Ends a session the driver left running — the app died, the phone was lost,
/// or they simply forgot. Stops the meter without waiting for the cron sweep.
Future<void> forceCloseSession(WidgetRef ref, String driverId) async {
  await ref.read(apiClientProvider).post('/api/admin/drivers/$driverId/close-session');
  ref.invalidate(driverBalancesProvider);
  ref.invalidate(adminDriverSessionsProvider(driverId));
  ref.invalidate(adminDriversProvider);
}

final adminTripsProvider = FutureProvider<List<AdminTripRow>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/reports/trips');
  return raw.map((e) => AdminTripRow.fromJson(e as Map<String, dynamic>)).toList();
});

/// Marks a trip as referred by GNN LLC, or takes that back.
///
/// The office has the last word here on purpose: commission rests on this,
/// nobody volunteers to pay it, and the office is the one that knows which
/// jobs it handed out. Refused once a trip is finished — the commission row
/// is already written by then, and quietly re-deriving money after the fact
/// is worse than making someone adjust the balance deliberately.
Future<void> setTripReferral(WidgetRef ref, String tripId, bool referred) async {
  await ref.read(apiClientProvider).put('/api/admin/trips/$tripId/referral', body: {'referred': referred});
  ref.invalidate(adminTripsProvider);
  ref.invalidate(driverBalancesProvider);
}

final adminUsersProvider = FutureProvider<List<AdminUser>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/users');
  return raw.map((e) => AdminUser.fromJson(e as Map<String, dynamic>)).toList();
});

/// Creates any role directly — including another admin, which is otherwise
/// impossible: bootstrap locks itself after the first one.
Future<void> createAdminUser(
  WidgetRef ref, {
  required String firstName,
  required String lastName,
  required String email,
  required String password,
  required String role,
  String? phone,
}) async {
  await ref.read(apiClientProvider).post(
    '/api/admin/users',
    body: {
      'firstName': firstName,
      'lastName': lastName,
      'email': email,
      'password': password,
      'role': role,
      'phone': ?phone,
    },
  );
  ref.invalidate(adminUsersProvider);
  ref.invalidate(adminDriversProvider);
}

/// Deactivating is the closest thing to deleting an account: login starts
/// returning 403 while the trip history stays intact for the books.
Future<void> updateAdminUser(
  WidgetRef ref,
  String userId, {
  bool? isActive,
  String? role,
}) async {
  await ref.read(apiClientProvider).put(
    '/api/admin/users/$userId',
    body: {'isActive': ?isActive, 'role': ?role},
  );
  ref.invalidate(adminUsersProvider);
  ref.invalidate(adminDriversProvider);
}

/// Hands a stuck job to a different driver. The Trips tab tells the office to
/// do this; until now there was no button.
Future<void> reassignTrip(WidgetRef ref, String tripId, String driverId) async {
  await ref.read(apiClientProvider).put(
    '/api/admin/trips/$tripId/reassign',
    body: {'driverId': driverId},
  );
  ref.invalidate(adminTripsProvider);
  ref.invalidate(adminDriversProvider);
}

final auditLogProvider = FutureProvider<List<AuditEntry>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/audit-logs', query: {'limit': 100});
  return raw.map((e) => AuditEntry.fromJson(e as Map<String, dynamic>)).toList();
});

final commissionChargesProvider = FutureProvider<List<CommissionCharge>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/reports/driver-commissions');
  return raw.map((e) => CommissionCharge.fromJson(e as Map<String, dynamic>)).toList();
});

// The "Service areas" admin screen that used these was removed — a service
// area determines nothing today (no dispatch/pricing code reads a city's
// bounds; see the changelog), so the UI was pure clutter. Left here
// deliberately: the backend (this + /api/admin/cities) is the reusable part
// if service areas are ever wired to something real, and rebuilding the
// admin screen at that point is cheap.
final citiesProvider = FutureProvider<List<City>>((ref) async {
  final raw = await ref.read(apiClientProvider).getList('/api/admin/cities');
  return raw.map((e) => City.fromJson(e as Map<String, dynamic>)).toList();
});

Future<void> createCity(
  WidgetRef ref, {
  required String name,
  String? state,
}) async {
  await ref.read(apiClientProvider).post(
    '/api/admin/cities',
    body: {'name': name, 'country': 'US', 'state': ?state, 'timezone': 'America/New_York'},
  );
  ref.invalidate(citiesProvider);
}

Future<void> deleteCity(WidgetRef ref, String cityId) async {
  await ref.read(apiClientProvider).delete('/api/admin/cities/$cityId');
  ref.invalidate(citiesProvider);
}

final pricingConfigProvider = FutureProvider<PricingConfig>((ref) async {
  final json = await ref.read(apiClientProvider).get('/api/admin/pricing');
  return PricingConfig.fromJson(json);
});

Future<void> updatePricing(
  WidgetRef ref, {
  required double baseFare,
  required double perMile,
  double? driverUsagePerMinute,
  double? driverCommissionPercent,
}) async {
  await ref.read(apiClientProvider).put(
    '/api/admin/pricing',
    body: {
      'baseFare': baseFare,
      'perMile': perMile,
      'driverUsagePerMinute': ?driverUsagePerMinute,
      'driverCommissionPercent': ?driverCommissionPercent,
    },
  );
  ref.invalidate(pricingConfigProvider);
}

/// Hands a job directly to a chosen driver, bypassing auto-dispatch. That
/// driver owes GNN LLC a commission on it, which the driver app discloses
/// before they accept.
Future<String> assignTripToDriver(
  WidgetRef ref, {
  required String driverId,
  required double pickupLat,
  required double pickupLng,
  required String pickupAddress,
  required String guestName,
  required String guestPhone,
  double? dropoffLat,
  double? dropoffLng,
  String? dropoffAddress,
  String? notes,
}) async {
  final json = await ref.read(apiClientProvider).post(
    '/api/admin/trips',
    body: {
      'driverId': driverId,
      'pickupLat': pickupLat,
      'pickupLng': pickupLng,
      'pickupAddress': pickupAddress,
      'guestName': guestName,
      'guestPhone': guestPhone,
      // The API requires all three dropoff fields together or none at all —
      // a phoned-in booking often has no destination until pickup.
      if (dropoffLat != null && dropoffLng != null && dropoffAddress != null) ...{
        'dropoffLat': dropoffLat,
        'dropoffLng': dropoffLng,
        'dropoffAddress': dropoffAddress,
      },
      'paymentMethod': 'cash',
      'notes': ?notes,
    },
  );
  ref.invalidate(adminTripsProvider);
  ref.invalidate(adminDriversProvider);
  return json['id'] as String;
}
