import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/api_client.dart';
import '../../core/fare_range.dart';
import '../../models/driver_profile.dart';
import '../../models/trip.dart';
import '../../widgets/error_banner.dart';
import '../../widgets/map_markers.dart';
import 'driver_controllers.dart';
import 'job_actions.dart';

class DriverHomeTab extends ConsumerWidget {
  const DriverHomeTab({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final profile = ref.watch(driverProfileProvider);
    final trips = ref.watch(driverTripsProvider);
    final job = ref.watch(currentJobProvider);

    return RefreshIndicator(
      onRefresh: () async {
        await ref.read(driverProfileProvider.notifier).refresh();
        await ref.read(driverTripsProvider.notifier).refresh();
      },
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          switch (profile) {
            AsyncLoading() when !profile.hasValue => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) when !profile.hasValue => ErrorBanner(message: error.toString()),
            AsyncValue(:final value?) => _OnlineToggleCard(profile: value),
            _ => const SizedBox.shrink(),
          },
          if (job != null) ...[
            const SizedBox(height: 16),
            _CurrentJobCard(job: job),
          ],
          const SizedBox(height: 24),
          Text('Recent jobs', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          switch (trips) {
            AsyncLoading() when !trips.hasValue => const Padding(
                padding: EdgeInsets.symmetric(vertical: 32),
                child: Center(child: CircularProgressIndicator()),
              ),
            AsyncError(:final error) when !trips.hasValue => ErrorBanner(message: error.toString()),
            AsyncValue(:final value?) => _JobHistory(trips: value, currentJobId: job?.id),
            _ => const SizedBox.shrink(),
          },
        ],
      ),
    );
  }
}

/// The switch that starts and stops the meter.
///
/// Going online opens a billable session on the server, so this says the
/// per-minute charge out loud rather than hiding it behind a neutral toggle —
/// a driver who leaves the app on overnight by accident pays for it.
class _OnlineToggleCard extends ConsumerStatefulWidget {
  const _OnlineToggleCard({required this.profile});

  final DriverProfile profile;

  @override
  ConsumerState<_OnlineToggleCard> createState() => _OnlineToggleCardState();
}

class _OnlineToggleCardState extends ConsumerState<_OnlineToggleCard> {
  bool _busy = false;

  Future<void> _toggle(bool online) async {
    // Going offline mid-job would strand a passenger; the server refuses it
    // anyway, so explain rather than firing a request that will be rejected.
    if (!online && widget.profile.isOnJob) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Finish or hand back your current job before going offline.')),
      );
      return;
    }

    setState(() => _busy = true);
    try {
      await ref.read(driverProfileProvider.notifier).setOnline(online);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message)));
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = widget.profile;
    final online = p.isOnline;
    final color = online ? Colors.green : Theme.of(context).disabledColor;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  width: 14,
                  height: 14,
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.statusLabel, style: Theme.of(context).textTheme.titleMedium),
                      Text(
                        online
                            ? 'You are being charged for this time.'
                            : 'You will not receive jobs while offline.',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                if (_busy)
                  const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
                else
                  Switch(value: online, onChanged: _toggle),
              ],
            ),
            if (!p.isVerified) ...[
              const SizedBox(height: 12),
              _Notice(
                icon: Icons.hourglass_bottom,
                text: 'Your account is not verified yet — the office needs to approve you '
                    'before dispatch will send you jobs.',
              ),
            ],
            if (!p.hasCompleteVehicle) ...[
              const SizedBox(height: 12),
              _Notice(
                icon: Icons.directions_car_outlined,
                text: 'Add your car and plate under Profile. Passengers use it to find you '
                    'at the kerb, and it shows on the map when they pick a driver.',
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _Notice extends StatelessWidget {
  const _Notice({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icon, size: 18),
          const SizedBox(width: 10),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall)),
        ],
      ),
    );
  }
}

/// The job in front of the driver right now, with its next action.
class _CurrentJobCard extends ConsumerWidget {
  const _CurrentJobCard({required this.job});

  final Trip job;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final isOffer = job.status == 'DRIVER_ASSIGNED';

    return Card(
      color: isOffer ? Theme.of(context).colorScheme.primaryContainer : null,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              isOffer ? 'New job offer' : job.statusLabel,
              style: Theme.of(context).textTheme.titleMedium,
            ),
            const SizedBox(height: 12),
            _AddressLine(isPickup: true, text: job.pickupAddress),
            const SizedBox(height: 8),
            _AddressLine(isPickup: false, text: job.dropoffAddress ?? 'Destination set at pickup'),
            const SizedBox(height: 12),
            JobEarningsSummary(job: job),
            const SizedBox(height: 16),
            JobActions(job: job),
            const SizedBox(height: 8),
            TextButton(
              onPressed: () => context.go('/home/job/${job.id}'),
              child: const Text('Open job details'),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddressLine extends StatelessWidget {
  const _AddressLine({required this.isPickup, required this.text});

  final bool isPickup;
  final String text;

  @override
  Widget build(BuildContext context) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        SizedBox(width: 20, child: Center(child: LegendDot(isPickup: isPickup))),
        const SizedBox(width: 12),
        Expanded(child: Text(text)),
      ],
    );
  }
}

class _JobHistory extends StatelessWidget {
  const _JobHistory({required this.trips, required this.currentJobId});

  final List<Trip> trips;
  final String? currentJobId;

  @override
  Widget build(BuildContext context) {
    // The live job already has its own card above; repeating it here just
    // makes the driver wonder if there are two.
    final past = trips.where((t) => t.id != currentJobId).toList();
    if (past.isEmpty) {
      return Padding(
        padding: const EdgeInsets.symmetric(vertical: 24),
        child: Text('No jobs yet.', style: Theme.of(context).textTheme.bodyMedium),
      );
    }

    return Column(
      children: [
        for (final trip in past)
          Card(
            margin: const EdgeInsets.only(bottom: 8),
            child: ListTile(
              title: Text(trip.destinationLabel, maxLines: 1, overflow: TextOverflow.ellipsis),
              subtitle: Text('${trip.statusLabel} · ${_formatDate(trip.requestedAt)}'),
              trailing: trip.driverTakeHome == null
                  ? null
                  : Text(formatFare(trip.driverTakeHome!, currency: trip.currency)),
              onTap: () => context.go('/home/job/${trip.id}'),
            ),
          ),
      ],
    );
  }

  String _formatDate(DateTime dt) {
    final local = dt.toLocal();
    final d = local.day.toString().padLeft(2, '0');
    final m = local.month.toString().padLeft(2, '0');
    return '$d.$m.${local.year}';
  }
}
