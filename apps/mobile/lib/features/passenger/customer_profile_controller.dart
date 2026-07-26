import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../models/customer_profile.dart';

/// The signed-in passenger's own lifetime trip count — the same "N trips"
/// figure the driver side already shows on its own profile tab, just never
/// wired on this side.
final customerProfileProvider = FutureProvider<CustomerProfile>((ref) async {
  final json = await ref.read(apiClientProvider).get('/api/customer/profile');
  return CustomerProfile.fromJson(json);
});
