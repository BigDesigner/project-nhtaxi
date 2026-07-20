import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/fare_range.dart';
import '../../models/driver_billing.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/help_card.dart';
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

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(driverBalanceProvider);
        ref.invalidate(driverSessionsProvider);
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
            _Line(label: 'Time on the app', amount: balance.usageFeeCharged),
            const SizedBox(height: 6),
            _Line(label: 'Commission on office jobs', amount: balance.commissionCharged),
            const SizedBox(height: 6),
            _Line(label: 'Charged in total', amount: balance.totalCharged, bold: true),
            const SizedBox(height: 6),
            _Line(label: 'Cash you have handed over', amount: -balance.totalCollected),
          ],
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.amount, this.bold = false});

  final String label;
  final double amount;
  final bool bold;

  @override
  Widget build(BuildContext context) {
    final style = Theme.of(context).textTheme.bodyMedium?.copyWith(
          fontWeight: bold ? FontWeight.bold : null,
        );
    final text = amount < 0
        ? '− ${formatFare(amount.abs())}'
        : formatFare(amount);
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [Text(label, style: style), Text(text, style: style)],
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
