import 'dart:async';

import 'package:flutter/material.dart';

import '../models/trip.dart';

/// The number GNN LLC's passengers watch while waiting for a driver.
///
/// Ticks off `trip.nextSearchAt`, which the server sets — it is not a local
/// 60-second timer. That matters because this widget appears on both the
/// home list and the trip screen: two independent countdowns would drift
/// apart and look broken, whereas two clocks counting to the same server
/// instant always agree.
class SearchCountdown extends StatefulWidget {
  const SearchCountdown({super.key, required this.trip, this.compact = false});

  final Trip trip;
  final bool compact;

  @override
  State<SearchCountdown> createState() => _SearchCountdownState();
}

class _SearchCountdownState extends State<SearchCountdown> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    // Local 1s repaint only — no network traffic. The actual re-search is the
    // server's job.
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final trip = widget.trip;
    final next = trip.nextSearchAt;
    final remaining = next == null ? Duration.zero : next.difference(DateTime.now());
    final seconds = remaining.isNegative ? 0 : remaining.inSeconds;

    final attempts = trip.maxSearchAttempts > 0
        ? 'Attempt ${trip.searchAttempts} of ${trip.maxSearchAttempts}'
        : 'Searching';

    final label = seconds > 0
        ? 'Checking again in ${seconds}s · $attempts'
        : 'Checking for a driver now · $attempts';

    if (widget.compact) {
      return Text(label, style: Theme.of(context).textTheme.bodySmall);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 12),
            Expanded(child: Text('Looking for a nearby driver', style: Theme.of(context).textTheme.titleMedium)),
          ],
        ),
        const SizedBox(height: 8),
        Text(label, style: Theme.of(context).textTheme.bodyMedium),
        const SizedBox(height: 8),
        if (trip.maxSearchAttempts > 0)
          LinearProgressIndicator(value: trip.searchAttempts / trip.maxSearchAttempts),
        const SizedBox(height: 8),
        Text(
          'We keep looking even if you close the app.',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}
