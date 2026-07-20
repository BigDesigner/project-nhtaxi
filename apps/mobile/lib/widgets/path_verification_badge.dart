import 'package:flutter/material.dart';

import '../core/path_verification.dart';

/// A quiet confirmation, or a flag worth a second look — never an accusation
/// on its own. `NOT_CHECKED` renders nothing: a trip with no breadcrumb data
/// (a dead phone, or one older than this feature) isn't evidence of anything,
/// so there is nothing useful to say about it.
class PathVerificationBadge extends StatelessWidget {
  const PathVerificationBadge({super.key, required this.verification});

  final TripPathVerification? verification;

  @override
  Widget build(BuildContext context) {
    final v = verification;
    if (v == null || !v.isChecked) return const SizedBox.shrink();

    final color = v.isMismatched ? Colors.amber.shade800 : Colors.green;
    final icon = v.isMismatched ? Icons.error_outline : Icons.check_circle_outline;
    final text = v.isMismatched
        ? 'Recorded path does not reach the booked pickup/dropoff'
            '${v.deviationMiles != null ? ' (off by ${v.deviationMiles!.toStringAsFixed(1)} mi)' : ''}.'
        : 'Recorded path matches the booked pickup and dropoff.';

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: color.withValues(alpha: 0.4)),
      ),
      child: Row(
        children: [
          Icon(icon, size: 18, color: color),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: color))),
        ],
      ),
    );
  }
}
