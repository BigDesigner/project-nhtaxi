import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../models/trip.dart';
import '../../widgets/map_markers.dart';
import 'referral_controller.dart';

/// The Referral button, shown when the driver is free.
///
/// The office rang them directly about a passenger who isn't in the app. One
/// tap opens the job here at the kerb; one tap closes it at the destination.
/// Nothing is typed, and nothing is remembered afterwards — see
/// [ReferralController] for why that distinction is the whole point.
class StartReferralCard extends ConsumerStatefulWidget {
  const StartReferralCard({super.key});

  @override
  ConsumerState<StartReferralCard> createState() => _StartReferralCardState();
}

class _StartReferralCardState extends ConsumerState<StartReferralCard> {
  bool _busy = false;

  Future<void> _start() async {
    // The tap happens with a passenger already getting into the car, so it
    // confirms rather than firing straight away — a mis-tap would otherwise
    // open a real, billable job.
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Start a referral job?'),
        content: const Text(
          'Use this when the office sent you to a passenger who is not in the app. '
          'We record where you are now as the pickup, and where you are when you '
          'tap Dropped off as the destination. The fare is worked out from the '
          'road between them.',
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Not now')),
          FilledButton(onPressed: () => Navigator.pop(context, true), child: const Text('Start')),
        ],
      ),
    );
    if (confirmed != true) return;

    setState(() => _busy = true);
    try {
      await ref.read(referralControllerProvider).start();
    } on NoLocationException catch (e) {
      _say(e.message);
    } on ApiException catch (e) {
      _say(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Referral job', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'The office sent you to someone who is not in the app. '
              'Tap as they get in — we take the pickup from where you are.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            FilledButton.icon(
              onPressed: _busy ? null : _start,
              icon: _busy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.person_add_alt),
              label: const Text('Passenger is in the car'),
            ),
          ],
        ),
      ),
    );
  }
}

/// A referral job under way.
///
/// It never passes through the accept/on-my-way/arrived states — there is no
/// passenger app on the other end to show them to — so it gets its own card
/// with exactly one action rather than the usual job controls.
class ActiveReferralCard extends ConsumerStatefulWidget {
  const ActiveReferralCard({super.key, required this.job});

  final Trip job;

  @override
  ConsumerState<ActiveReferralCard> createState() => _ActiveReferralCardState();
}

class _ActiveReferralCardState extends ConsumerState<ActiveReferralCard> {
  bool _busy = false;

  Future<void> _complete() async {
    setState(() => _busy = true);
    try {
      final trip = await ref.read(referralControllerProvider).complete(widget.job.id);
      final fare = trip.displayFare;
      if (fare != null) {
        _say('Trip finished — ${formatFare(fare, currency: trip.currency)} to collect in cash.');
      }
    } on NoLocationException catch (e) {
      // Deliberately not "trip finished anyway". Without the dropoff there is
      // no distance, and without a distance there is no honest fare.
      _say(e.message);
    } on ApiException catch (e) {
      _say(e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  void _say(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: Theme.of(context).colorScheme.primaryContainer,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Referral job in progress', style: Theme.of(context).textTheme.titleMedium),
            const SizedBox(height: 12),
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                SizedBox(width: 20, child: Center(child: LegendDot(isPickup: true))),
                const SizedBox(width: 12),
                Expanded(child: Text('Picked up at ${widget.job.pickupAddress}')),
              ],
            ),
            const SizedBox(height: 12),
            // Said plainly rather than left to be discovered on the balance
            // screen later: this is a job the office referred, so it carries a
            // cut. The rate was fixed when the job opened.
            if (widget.job.commissionPercent != null)
              Text(
                'GNN LLC referred this job — ${widget.job.commissionPercent!.toStringAsFixed(0)}% commission '
                'on the fare, worked out when you drop off.',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            const SizedBox(height: 16),
            FilledButton.icon(
              onPressed: _busy ? null : _complete,
              icon: _busy
                  ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.flag_outlined),
              label: const Text('Dropped off here'),
            ),
          ],
        ),
      ),
    );
  }
}
