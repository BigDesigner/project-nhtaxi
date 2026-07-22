import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../core/trip_id.dart';

/// Shows a trip's short id with a one-tap "copy" that puts the *full* id on the
/// clipboard — so a passenger, driver or admin can read the short code aloud
/// but hand support the exact, unambiguous id. Sits at the foot of every trip
/// detail view.
class TripIdRow extends StatelessWidget {
  const TripIdRow({super.key, required this.tripId});

  final String tripId;

  @override
  Widget build(BuildContext context) {
    final messenger = ScaffoldMessenger.of(context);
    return Row(
      children: [
        Icon(Icons.tag, size: 18, color: Theme.of(context).disabledColor),
        const SizedBox(width: 6),
        Text('Trip ID: ', style: Theme.of(context).textTheme.bodySmall),
        Expanded(
          child: Text(
            shortTripId(tripId),
            style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  fontFeatures: const [FontFeature.tabularFigures()],
                  fontWeight: FontWeight.w600,
                ),
          ),
        ),
        TextButton.icon(
          icon: const Icon(Icons.copy, size: 16),
          label: const Text('Copy'),
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: tripId));
            messenger.showSnackBar(
              const SnackBar(content: Text('Trip ID copied'), duration: Duration(seconds: 2)),
            );
          },
        ),
      ],
    );
  }
}
