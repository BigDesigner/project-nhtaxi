import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/fare_range.dart';
import '../../core/report_tables.dart';
import '../../models/driver_billing.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
import '../../widgets/report_export_sheet.dart';
import 'driver_controllers.dart';

/// What the driver owes GNN LLC, and the hours behind it.
///
/// Deliberately framed as "what I owe" rather than "earnings": the money the
/// driver makes is cash in their pocket that never touches this system. The
/// only figures GNNcab holds are the ones they have to hand back, so showing
/// them plainly — and showing the hours that produced them — is what makes
/// the cash hand-over uncontroversial.
class DriverEarningsTab extends ConsumerWidget {
  const DriverEarningsTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance = ref.watch(driverBalanceProvider);
    final sessions = ref.watch(driverSessionsProvider);
    final earnings = ref.watch(driverEarningsProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(driverBalanceProvider);
        ref.invalidate(driverSessionsProvider);
        ref.invalidate(driverEarningsProvider);
        await ref.read(driverBalanceProvider.future);
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          switch (balance) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _BalanceCard(balance: value),
          },
          const SizedBox(height: 16),
          // The other half of the picture. Showing a driver only what they owe
          // is a strange thing to do when the money they earn never passes
          // through this system and this is its only record.
          switch (earnings) {
            AsyncLoading() => const SizedBox.shrink(),
            AsyncError() => const SizedBox.shrink(),
            AsyncData(:final value) => _EarningsCard(earnings: value),
          },
          // A driver's earnings are their own income to declare, so they can
          // take a copy without going through the office.
          if (earnings.hasValue && earnings.value!.trips.isNotEmpty) ...[
            const SizedBox(height: 8),
            OutlinedButton.icon(
              icon: const Icon(Icons.download_outlined, size: 18),
              label: const Text('Export my earnings (PDF / CSV)'),
              onPressed: () async {
                final name = ref.read(driverProfileProvider).value?.fullName ?? 'Driver';
                final table = driverOwnEarningsTable(earnings.value!, driverName: name);
                await showReportExportSheet(context, table);
              },
            ),
          ],
          const SizedBox(height: 24),
          Text('When you were online', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 4),
          Text(
            'Every minute online is charged, whether or not a job came in.',
            style: Theme.of(context).textTheme.bodySmall,
          ),
          const SizedBox(height: 8),
          switch (sessions) {
            AsyncLoading() => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) => ErrorBanner(message: error.toString()),
            AsyncData(:final value) => _SessionList(sessions: value),
          },
          const SizedBox(height: 16),
          const HelpCard(
            title: 'Something look wrong?',
            message: 'Call the office and we will go through it with you.',
          ),
        ],
      ),
    );
  }
}

class _BalanceCard extends StatelessWidget {
  const _BalanceCard({required this.balance});

  final DriverBalance balance;

  @override
  Widget build(BuildContext context) {
    final owes = balance.pendingBalance > 0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('You owe GNN LLC', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(
              formatFare(balance.pendingBalance),
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                    fontWeight: FontWeight.bold,
                    color: owes ? null : Colors.green,
                  ),
            ),
            if (balance.hasOpenSession)
              Text(
                'You are online, so this is still going up.',
                style: Theme.of(context).textTheme.bodySmall,
              )
            else if (!owes)
              Text('All settled up.', style: Theme.of(context).textTheme.bodySmall),
            const Divider(height: 28),
            Text('How this adds up', style: Theme.of(context).textTheme.labelLarge),
            const SizedBox(height: 12),
            // The two things that grow the debt, each said plainly. Neither is
            // money the driver hands over from a trip — trip cash is theirs and
            // never enters this card (see _EarningsCard).
            _Line(
              label: 'App usage fee',
              subtitle: 'Every minute you are online, job or no job',
              amount: balance.usageFeeCharged,
            ),
            const SizedBox(height: 10),
            _Line(
              label: 'Commission on office jobs',
              subtitle: 'Only on jobs GNN LLC referred to you',
              amount: balance.commissionCharged,
            ),
            const SizedBox(height: 10),
            _Line(label: 'Charged in total', amount: balance.totalCharged, bold: true),
            const SizedBox(height: 10),
            // What the office has already collected against that total. The
            // driver never records this — it's the office's own log of cash
            // handed back on a settle-up, shown here so the top figure adds up.
            _Line(
              label: 'Paid to GNN LLC so far',
              subtitle: 'Cash the office has recorded receiving',
              amount: -balance.totalCollected,
            ),
            const Divider(height: 24),
            // The same number as the headline above, closing the arithmetic:
            // charges − paid = what's still owed.
            _Line(label: 'Still owed', amount: balance.pendingBalance, bold: true),
          ],
        ),
      ),
    );
  }
}

/// What the driver actually took, in cash, from completed trips.
class _EarningsCard extends StatelessWidget {
  const _EarningsCard({required this.earnings});

  final DriverEarnings earnings;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('You have earned', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(
              formatFare(earnings.totalEarnings, currency: earnings.currency),
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.bold),
            ),
            Text(
              earnings.tripCount == 1 ? 'from 1 completed trip' : 'from ${earnings.tripCount} completed trips',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            Text(
              'Paid to you directly in cash — this is a record, not a payment.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
          ],
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.amount, this.subtitle, this.bold = false});

  final String label;
  final String? subtitle;
  final double amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(
          fontWeight: bold ? FontWeight.bold : null,
        );
    // Negative amounts are the ones that reduce the debt (cash paid back), so
    // they carry an explicit minus; everything else adds to it.
    final text = amount < 0 ? '− ${formatFare(amount.abs())}' : formatFare(amount);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(label, style: style),
              if (subtitle != null)
                Text(subtitle!, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        ),
        const SizedBox(width: 12),
        Text(text, style: style),
      ],
    );
  }
}

class _SessionList extends StatelessWidget {
  const _SessionList({required this.sessions});

  final List<DriverSession> sessions;

  @override
  Widget build(BuildContext context) {
    if (sessions.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text(
          'You have not been online yet.',
          style: Theme.of(context).textTheme.bodyMedium,
        ),
      );
    }

    return Column(
      children: [
        for (final s in sessions)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Icon(
                s.isOpen ? Icons.play_circle : Icons.check_circle_outline,
                color: s.isOpen ? Colors.green : null,
              ),
              title: Text(_dayLabel(s.startedAt)),
              subtitle: Text(
                [
                  _timeRange(s),
                  if (s.durationMinutes != null) _duration(s.durationMinutes!),
                  // A session the server closed on its own still cost money;
                  // saying so avoids a "what is this charge?" phone call.
                  if (s.wasTimedOut) s.closedReasonLabel,
                ].join(' · '),
              ),
              trailing: s.charge == null
                  ? (s.isOpen ? const Text('running') : null)
                  : Text(formatFare(s.charge!)),
            ),
          ),
      ],
    );
  }

  String _dayLabel(DateTime dt) {
    final d = dt.toLocal();
    const months = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
    ];
    return '${d.day} ${months[d.month - 1]} ${d.year}';
  }

  String _timeRange(DriverSession s) {
    final from = _hhmm(s.startedAt);
    if (s.endedAt == null) return 'from $from';
    return '$from – ${_hhmm(s.endedAt!)}';
  }

  String _hhmm(DateTime dt) {
    final d = dt.toLocal();
    return '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }

  String _duration(int minutes) {
    if (minutes < 60) return '${minutes}m';
    final h = minutes ~/ 60;
    final m = minutes % 60;
    return m == 0 ? '${h}h' : '${h}h ${m}m';
  }
}
