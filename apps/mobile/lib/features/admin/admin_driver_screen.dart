import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../models/admin.dart';
import '../../models/driver_billing.dart';
import '../../widgets/app_back_button.dart';
import '../../widgets/error_banner.dart';
import 'admin_controllers.dart';
import 'admin_documents_section.dart';

/// One driver in full: what they owe, the hours behind it, and the button
/// that records a cash hand-over.
class AdminDriverScreen extends ConsumerWidget {
  const AdminDriverScreen({super.key, required this.driverId});

  final String driverId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final drivers = ref.watch(adminDriversProvider);
    final balances = ref.watch(driverBalancesProvider);
    final sessions = ref.watch(adminDriverSessionsProvider(driverId));

    final driver = drivers.value?.where((d) => d.id == driverId).firstOrNull;
    final balance = balances.value?.where((b) => b.driverId == driverId).firstOrNull;

    return Scaffold(
      appBar: AppBar(
        title: Text(driver?.fullName ?? 'Driver'),
        leading: const AppBackButton(),
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(driverBalancesProvider);
          ref.invalidate(adminDriverSessionsProvider(driverId));
          ref.invalidate(adminDriverDetailProvider(driverId));
          await ref.read(driverBalancesProvider.future);
        },
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (driver != null) _DriverSummary(driver: driver),
            const SizedBox(height: 16),
            // Paperwork and the Approve button together — approving used to
            // sit on a screen with nothing to review.
            AdminDocumentsSection(driverId: driverId),
            const SizedBox(height: 16),
            // A driver with no billing history has no row in the report at
            // all, which is not an error — it just means nothing is owed.
            _BalanceSection(driverId: driverId, balance: balance, loading: balances.isLoading),
            const SizedBox(height: 24),
            Text('Sessions', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 8),
            switch (sessions) {
              AsyncLoading() => const Padding(
                  padding: EdgeInsets.symmetric(vertical: 24),
                  child: Center(child: CircularProgressIndicator()),
                ),
              AsyncError(:final error) => ErrorBanner(message: error.toString()),
              AsyncData(:final value) => _Sessions(driverId: driverId, sessions: value),
            },
          ],
        ),
      ),
    );
  }
}

class _DriverSummary extends StatelessWidget {
  const _DriverSummary({required this.driver});

  final AdminDriver driver;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Column(
        children: [
          ListTile(
            leading: const Icon(Icons.badge_outlined),
            title: Text(driver.isVerified ? 'Approved' : 'Not approved yet'),
            subtitle: Text(driver.isVerified ? driver.status.toLowerCase() : 'Cannot go online'),
          ),
          if (driver.phone != null)
            ListTile(
              leading: const Icon(Icons.phone_outlined),
              title: const Text('Phone'),
              subtitle: Text(driver.phone!),
            ),
          ListTile(
            leading: const Icon(Icons.email_outlined),
            title: const Text('Email'),
            subtitle: Text(driver.email),
          ),
          ListTile(
            leading: const Icon(Icons.directions_car_outlined),
            title: const Text('Vehicle'),
            subtitle: Text(driver.vehicleDescription ?? 'Not filled in'),
          ),
        ],
      ),
    );
  }
}

class _BalanceSection extends ConsumerStatefulWidget {
  const _BalanceSection({required this.driverId, required this.balance, required this.loading});

  final String driverId;
  final DriverBalanceRow? balance;
  final bool loading;

  @override
  ConsumerState<_BalanceSection> createState() => _BalanceSectionState();
}

class _BalanceSectionState extends ConsumerState<_BalanceSection> {
  Future<void> _recordCash() async {
    final amountController = TextEditingController(
      // Pre-filled with the full outstanding amount, because that's what
      // normally changes hands. Still editable for a part payment.
      text: widget.balance == null ? '' : widget.balance!.pendingBalance.toStringAsFixed(2),
    );
    final notesController = TextEditingController();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Record cash received'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: amountController,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: const InputDecoration(labelText: 'Amount', prefixText: r'$'),
            ),
            const SizedBox(height: 12),
            TextField(
              controller: notesController,
              decoration: const InputDecoration(labelText: 'Note (optional)'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Record')),
        ],
      ),
    );

    final amount = double.tryParse(amountController.text.trim());
    final notes = notesController.text.trim();
    amountController.dispose();
    notesController.dispose();

    if (confirmed != true) return;
    if (amount == null || amount <= 0) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Enter an amount above zero.')));
      }
      return;
    }

    try {
      await recordCashCollection(ref, widget.driverId, amount: amount, notes: notes);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Recorded ${formatFare(amount)}')),
        );
      }
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.loading) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 24),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    final b = widget.balance;
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Owes GNN LLC', style: Theme.of(context).textTheme.bodyMedium),
            const SizedBox(height: 4),
            Text(
              formatFare(b?.pendingBalance ?? 0),
              style: Theme.of(context).textTheme.headlineMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
            if (b?.hasOpenSession ?? false)
              Text('Currently online — still climbing.', style: Theme.of(context).textTheme.bodySmall),
            if (b != null) ...[
              const Divider(height: 28),
              _Line(label: 'Time on the app', amount: b.usageFeeCharged),
              const SizedBox(height: 6),
              _Line(label: 'Commission', amount: b.commissionCharged),
              const SizedBox(height: 6),
              _Line(label: 'Cash already received', amount: b.totalCollected),
            ],
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _recordCash,
              icon: const Icon(Icons.payments),
              label: const Text('Record cash received'),
            ),
          ],
        ),
      ),
    );
  }
}

class _Line extends StatelessWidget {
  const _Line({required this.label, required this.amount});

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

class _Sessions extends ConsumerStatefulWidget {
  const _Sessions({required this.driverId, required this.sessions});

  final String driverId;
  final List<DriverSession> sessions;

  @override
  ConsumerState<_Sessions> createState() => _SessionsState();
}

class _SessionsState extends ConsumerState<_Sessions> {
  bool _closing = false;

  Future<void> _forceClose() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Close this session?'),
        content: const Text(
          'Stops the meter now and bills the time so far. Use this when a driver has '
          'left the app running by mistake.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Leave it')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Close session')),
        ],
      ),
    );
    if (ok != true) return;

    setState(() => _closing = true);
    try {
      await forceCloseSession(ref, widget.driverId);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _closing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    if (widget.sessions.isEmpty) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 16),
        child: Text('This driver has never been online.'),
      );
    }

    final hasOpen = widget.sessions.any((s) => s.isOpen);

    return Column(
      children: [
        if (hasOpen)
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: _closing
                ? const Center(child: CircularProgressIndicator())
                : OutlinedButton.icon(
                    onPressed: _forceClose,
                    icon: const Icon(Icons.stop_circle_outlined),
                    label: const Text('Force-close the open session'),
                  ),
          ),
        for (final s in widget.sessions)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              leading: Icon(
                s.isOpen ? Icons.play_circle : Icons.check_circle_outline,
                color: s.isOpen ? Colors.green : null,
              ),
              title: Text(_range(s)),
              subtitle: Text(
                [
                  if (s.durationMinutes != null) _duration(s.durationMinutes!),
                  if (s.closedReason != null) s.closedReasonLabel,
                ].join(' · '),
                style: Theme.of(context).textTheme.bodySmall,
              ),
              trailing: s.charge == null ? const Text('running') : Text(formatFare(s.charge!)),
            ),
          ),
      ],
    );
  }

  String _range(DriverSession s) {
    final start = s.startedAt.toLocal();
    final date = '${start.day.toString().padLeft(2, '0')}.${start.month.toString().padLeft(2, '0')}';
    final from = _hhmm(s.startedAt);
    if (s.endedAt == null) return '$date from $from';
    return '$date $from – ${_hhmm(s.endedAt!)}';
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
