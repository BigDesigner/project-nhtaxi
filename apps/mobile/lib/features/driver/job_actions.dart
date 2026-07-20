import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../models/trip.dart';
import 'driver_controllers.dart';

/// The one action a job is waiting for, given where it is in its life.
///
/// Deliberately a single button rather than a row of options: at any point
/// there is exactly one thing a driver is meant to do next, and a driver
/// glancing at a phone at the kerb should not have to pick from a menu. The
/// offer stage is the exception — accept and decline are both legitimate.
({String label, String status, IconData icon})? _nextStep(Trip job) => switch (job.status) {
      'DRIVER_ACCEPTED' => (label: "I'm on my way", status: 'DRIVER_EN_ROUTE', icon: Icons.navigation),
      'DRIVER_EN_ROUTE' => (label: "I've arrived", status: 'DRIVER_ARRIVED', icon: Icons.place),
      // This is the moment the trip actually begins, so it's worded as the
      // physical event rather than "start trip".
      'DRIVER_ARRIVED' => (label: 'Passenger is in the car', status: 'TRIP_STARTED', icon: Icons.person_add),
      'TRIP_STARTED' => (label: 'Dropped off — finish job', status: 'TRIP_COMPLETED', icon: Icons.flag),
      _ => null,
    };

class JobActions extends ConsumerStatefulWidget {
  const JobActions({super.key, required this.job});

  final Trip job;

  @override
  ConsumerState<JobActions> createState() => _JobActionsState();
}

class _JobActionsState extends ConsumerState<JobActions> {
  bool _busy = false;

  Future<void> _send(String status) async {
    setState(() => _busy = true);
    try {
      await ref.read(driverTripsProvider.notifier).setStatus(widget.job.id, status);
    } on ApiException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _accept() async {
    // A commission is money out of the driver's pocket, so it gets an
    // explicit confirmation with the figure spelled out — accepting must
    // never be the moment they find out what it costs.
    if (widget.job.commissionPercent != null) {
      final ok = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('This job pays GNN LLC a commission'),
          content: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'The office assigned you this job. If you take it, '
                '${widget.job.commissionPercent!.toStringAsFixed(0)}% of the fare goes to GNN LLC '
                'and is added to what you owe.',
              ),
              const SizedBox(height: 16),
              _CommissionBreakdown(job: widget.job),
            ],
          ),
          actions: [
            TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Not this one')),
            FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Accept job')),
          ],
        ),
      );
      if (ok != true) return;
    }
    await _send('DRIVER_ACCEPTED');
  }

  Future<void> _decline() async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Turn down this job?'),
        content: const Text('It goes back to dispatch and we look for another driver.'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Keep it')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Turn it down')),
        ],
      ),
    );
    if (ok == true) await _send('DRIVER_REJECTED');
  }

  @override
  Widget build(BuildContext context) {
    if (_busy) {
      return const Padding(
        padding: EdgeInsets.symmetric(vertical: 12),
        child: Center(child: CircularProgressIndicator()),
      );
    }

    if (widget.job.status == 'DRIVER_ASSIGNED') {
      return Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          FilledButton.icon(
            onPressed: _accept,
            icon: const Icon(Icons.check),
            label: const Text('Accept job'),
            style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
          ),
          const SizedBox(height: 8),
          OutlinedButton(onPressed: _decline, child: const Text('Turn it down')),
        ],
      );
    }

    final step = _nextStep(widget.job);
    if (step == null) return const SizedBox.shrink();

    return FilledButton.icon(
      onPressed: () => _send(step.status),
      icon: Icon(step.icon),
      label: Text(step.label),
      style: FilledButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
    );
  }
}

/// What the driver actually walks away with, after GNN LLC's cut.
class JobEarningsSummary extends StatelessWidget {
  const JobEarningsSummary({super.key, required this.job});

  final Trip job;

  @override
  Widget build(BuildContext context) {
    final fare = job.displayFare;
    if (fare == null) return const SizedBox.shrink();

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(job.distanceMiles == null ? 'Fare' : '${job.distanceMiles!.toStringAsFixed(1)} mi'),
              Text(
                formatFare(fare, currency: job.currency),
                style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
              ),
            ],
          ),
          if (job.commissionPercent != null) ...[
            const Divider(height: 20),
            _CommissionBreakdown(job: job),
          ],
        ],
      ),
    );
  }
}

class _CommissionBreakdown extends StatelessWidget {
  const _CommissionBreakdown({required this.job});

  final Trip job;

  @override
  Widget build(BuildContext context) {
    final fare = job.displayFare;
    final commission = job.commissionOwed;
    final take = job.driverTakeHome;
    if (fare == null || commission == null || take == null) return const SizedBox.shrink();

    final small = Theme.of(context).textTheme.bodySmall;
    return Column(
      children: [
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('Fare you collect in cash', style: small),
            Text(formatFare(fare, currency: job.currency), style: small),
          ],
        ),
        const SizedBox(height: 4),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('GNN LLC commission (${job.commissionPercent!.toStringAsFixed(0)}%)', style: small),
            Text('− ${formatFare(commission, currency: job.currency)}', style: small),
          ],
        ),
        const SizedBox(height: 6),
        Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Text('You keep', style: Theme.of(context).textTheme.bodyMedium),
            Text(
              formatFare(take, currency: job.currency),
              style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ],
    );
  }
}
