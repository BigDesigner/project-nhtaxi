import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/fare_range.dart';
import '../../models/admin.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';

/// What the drivers collectively owe, and what's been collected.
///
/// This is the report the owner actually runs the business off: it's what
/// they carry into a cash hand-over. Pending balance leads; the breakdown by
/// charge type is there so a disputed figure can be traced without leaving
/// the screen.
class AdminMoneyTab extends ConsumerWidget {
  const AdminMoneyTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balances = ref.watch(driverBalancesProvider);
    final collections = ref.watch(cashCollectionsProvider);
    final commissions = ref.watch(commissionChargesProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(driverBalancesProvider);
        ref.invalidate(cashCollectionsProvider);
        ref.invalidate(commissionChargesProvider);
        await ref.read(driverBalancesProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          switch (balances) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _Outstanding(rows: value),
          },
          const SizedBox(height: 24),
          Text('Commission charges', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Only jobs GNN LLC referred. Ordinary dispatch work carries none — that '
            'is what the time-on-app charge already pays for.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          switch (commissions) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 24),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _Commissions(charges: value),
          },
          const SizedBox(height: 24),
          Text('Cash collected', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          switch (collections) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _Collections(items: value),
          },
        ],
      ),
    );
  }
}

class _Outstanding extends StatelessWidget {
  const _Outstanding({required this.rows});

  final List<DriverBalanceRow> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Text('Nothing billed yet.'),
      );
    }

    final total = rows.fold<double>(0, (sum, r) => sum + r.pendingBalance);
    final usage = rows.fold<double>(0, (sum, r) => sum + r.usageFeeCharged);
    final commission = rows.fold<double>(0, (sum, r) => sum + r.commissionCharged);
    // Biggest debtor first — that's who to chase.
    final sorted = [...rows]..sort((a, b) => b.pendingBalance.compareTo(a.pendingBalance));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Outstanding across all drivers', style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 4),
                Text(
                  formatFare(total),
                  style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
                ),
                const Divider(height: 28),
                _Split(label: 'Charged for time on the app', amount: usage),
                const SizedBox(height: 6),
                _Split(label: 'Charged as commission', amount: commission),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
        Text('By driver', style: Theme.of(context).textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final r in sorted)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text(r.driverName),
              subtitle: Text(
                'Time ${formatFare(r.usageFeeCharged)} · '
                'Commission ${formatFare(r.commissionCharged)} · '
                'Paid ${formatFare(r.totalCollected)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              trailing: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(
                    formatFare(r.pendingBalance),
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
                  ),
                  if (r.hasOpenSession)
                    Text('online', style: Theme.of(context).textTheme.labelSmall?.copyWith(color: Colors.green)),
                ],
              ),
              onTap: () => context.go('/home/driver/${r.driverId}'),
            ),
          ),
      ],
    );
  }
}

class _Split extends StatelessWidget {
  const _Split({required this.label, required this.amount});

  final String label;
  final double amount;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium;
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [Text(label, style: style), Text(formatFare(amount), style: style)],
    );
  }
}

/// Every commission charged, newest first. This is what somebody disputing a
/// figure on their balance actually needs — the totals above cannot answer
/// "which job was that?".
class _Commissions extends StatelessWidget {
  const _Commissions({required this.charges});

  final List<CommissionCharge> charges;

  @override
  Widget build(BuildContext context) {
    if (charges.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text('No commission charged yet.'),
      );
    }

    return Column(
      children: [
        for (final c in charges)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: const Icon(Icons.handshake),
              title: Text(c.driverName),
              subtitle: Text(
                'Fare ${formatFare(c.fare)} · ${c.commissionPercent.toStringAsFixed(0)}% · '
                '${_formatDate(c.createdAt)}',
                style: Theme.of(context).textTheme.bodySmall,
              ),
              trailing: Text(
                formatFare(c.commission),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
            ),
          ),
      ],
    );
  }

  String _formatDate(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
  }
}

class _Collections extends StatelessWidget {
  const _Collections({required this.items});

  final List<CashCollection> items;

  @override
  Widget build(BuildContext context) {
    if (items.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text('No cash recorded yet.'),
      );
    }

    return Column(
      children: [
        for (final c in items)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: const Icon(Icons.payments_outlined),
              title: Text(c.driverName),
              subtitle: Text(
                [
                  _formatDate(c.collectedAt),
                  'taken by ${c.collectedByName}',
                  if (c.notes != null && c.notes!.isNotEmpty) c.notes!,
                ].join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              trailing: Text(
                formatFare(c.amount),
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
            ),
          ),
      ],
    );
  }

  String _formatDate(DateTime dt) {
    final d = dt.toLocal();
    return '${d.day.toString().padLeft(2, '0')}.${d.month.toString().padLeft(2, '0')}.${d.year}';
  }
}
