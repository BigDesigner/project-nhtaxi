import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

/// The fleet, with verification front and centre.
///
/// An unverified driver cannot go online at all, so they're pinned to the top
/// rather than sorted in alphabetically — a new sign-up sitting unnoticed in
/// a list is someone who cannot work.
class AdminDriversTab extends ConsumerWidget {
  const AdminDriversTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drivers = ref.watch(adminDriversProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(adminDriversProvider);
        await ref.read(adminDriversProvider.future);
      },
      child: switch (drivers) {
        AsyncLoading() => const Center(child: CircularProgressIndicator()),
        AsyncError(:final error) => ListView(
            padding: const EdgeInsets.all(16),
            children: [ErrorBanner(message: error.toString())],
          ),
        AsyncData(:final value) => _DriverList(drivers: value),
      },
    );
  }
}

class _DriverList extends ConsumerWidget {
  const _DriverList({required this.drivers});

  final List<AdminDriver> drivers;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (drivers.isEmpty) {
      return ListView(
        children: const [
          Padding(
            padding: EdgeInsets.all(32),
            child: Center(child: Text('No drivers have signed up yet.')),
          ),
        ],
      );
    }

    final pending = drivers.where((d) => !d.isVerified).toList();
    final active = drivers.where((d) => d.isVerified).toList();

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        if (pending.isNotEmpty) ...[
          Text('Waiting for approval', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'These drivers cannot go online until you approve them.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          for (final d in pending) _DriverCard(driver: d),
          const SizedBox(height: 24),
        ],
        Text('Approved drivers', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        if (active.isEmpty)
          const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('None yet.'))
        else
          for (final d in active) _DriverCard(driver: d),
      ],
    );
  }
}

/// A row in the fleet list. Approving is deliberately not here — it belongs
/// next to the documents on the driver's own screen.
class _DriverCard extends StatelessWidget {
  const _DriverCard({required this.driver});

  final AdminDriver driver;

  @override
  Widget build(BuildContext context) {
    final d = driver;

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        children: [
          ListTile(
            leading: CircleAvatar(
              backgroundColor: d.isOnline ? Colors.green.withValues(alpha: 0.15) : null,
              child: Icon(
                Icons.person,
                color: d.isOnline ? Colors.green : Theme.of(context).disabledColor,
              ),
            ),
            title: Text(d.fullName),
            subtitle: Text(
              [
                d.vehicleDescription ?? 'No vehicle details',
                if (d.isVerified) d.status.toLowerCase(),
              ].join(' · '),
            ),
            trailing: Text('${d.totalTrips} trips', style: Theme.of(context).textTheme.bodySmall),
            onTap: () => context.go('/home/driver/${d.id}'),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 0, 8, 8),
            child: Row(
              children: [
                Expanded(
                  child: Text(
                    d.phone ?? d.email,
                    style: Theme.of(context).textTheme.bodySmall,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                TextButton(
                  // Approving happens on the driver's own screen, next to the
                  // documents it should be based on.
                  onPressed: () => context.go('/home/driver/${d.id}'),
                  child: Text(d.isVerified ? 'Review' : 'Review & approve'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
