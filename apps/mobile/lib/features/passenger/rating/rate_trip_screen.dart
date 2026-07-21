import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';
import '../../../models/rating.dart';
import '../../../widgets/star_rating.dart';
import 'rating_controller.dart';

/// The five-question rating form, opened from the completed-trip screen.
///
/// Every question must be answered before submitting — a half-filled rating
/// muddies the driver's average with implied zeros. The comment is optional.
class RateTripScreen extends ConsumerStatefulWidget {
  const RateTripScreen({super.key, required this.tripId, required this.driverName});

  final String tripId;
  final String driverName;

  @override
  ConsumerState<RateTripScreen> createState() => _RateTripScreenState();
}

class _RateTripScreenState extends ConsumerState<RateTripScreen> {
  final _stars = <String, int>{for (final q in ratingQuestions) q.key: 0};
  final _comment = TextEditingController();
  bool _submitting = false;
  String? _error;

  bool get _complete => _stars.values.every((v) => v > 0);

  @override
  void dispose() {
    _comment.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_complete) {
      setState(() => _error = 'Please answer every question first.');
      return;
    }
    setState(() {
      _submitting = true;
      _error = null;
    });
    try {
      await submitRating(ref, widget.tripId, stars: _stars, comment: _comment.text.trim());
      if (mounted) Navigator.of(context).pop(true);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Rate your trip')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text(
            'How was your ride with ${widget.driverName}?',
            style: Theme.of(context).textTheme.titleMedium,
          ),
          const SizedBox(height: 16),
          for (final q in ratingQuestions) ...[
            Text(q.prompt, style: Theme.of(context).textTheme.bodyLarge),
            const SizedBox(height: 4),
            StarInput(
              value: _stars[q.key]!,
              onChanged: (v) => setState(() => _stars[q.key] = v),
            ),
            const SizedBox(height: 16),
          ],
          TextField(
            controller: _comment,
            maxLines: 3,
            maxLength: 1000,
            decoration: const InputDecoration(
              labelText: 'Anything to add? (optional)',
              alignLabelWithHint: true,
              border: OutlineInputBorder(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 8),
            Text(_error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
          ],
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _submitting ? null : _submit,
            child: _submitting
                ? const SizedBox(height: 20, width: 20, child: CircularProgressIndicator(strokeWidth: 2))
                : const Text('Submit rating'),
          ),
        ],
      ),
    );
  }
}

/// A read-only recap of a rating already given, shown in place of the form
/// once a trip has been rated.
class RatingSummary extends StatelessWidget {
  const RatingSummary({super.key, required this.rating});

  final TripRating rating;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Text('You rated this trip', style: Theme.of(context).textTheme.titleMedium),
            const Spacer(),
            StarDisplay(value: rating.overall),
          ],
        ),
        if (rating.comment != null && rating.comment!.isNotEmpty) ...[
          const SizedBox(height: 8),
          Text('“${rating.comment!}”', style: Theme.of(context).textTheme.bodyMedium),
        ],
      ],
    );
  }
}
