import 'package:flutter/material.dart';

const _starColor = Color(0xFFF59E0B); // amber 500

/// A read-only row of stars for a score. Renders half-filled stars so a 4.6
/// doesn't round away the detail that makes an average worth showing.
class StarDisplay extends StatelessWidget {
  const StarDisplay({super.key, required this.value, this.size = 18});

  final double value;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          Icon(
            value >= i
                ? Icons.star
                : value >= i - 0.5
                    ? Icons.star_half
                    : Icons.star_border,
            color: _starColor,
            size: size,
          ),
      ],
    );
  }
}

/// A compact "★ 4.6 (23)" chip for a list row or map sheet. Shows nothing at
/// all when the driver has no ratings yet — an empty space beats a fake zero.
class RatingChip extends StatelessWidget {
  const RatingChip({super.key, required this.rating, required this.count});

  final double? rating;
  final int count;

  @override
  Widget build(BuildContext context) {
    if (rating == null || count == 0) return const SizedBox.shrink();
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        const Icon(Icons.star, color: _starColor, size: 16),
        const SizedBox(width: 2),
        Text(
          '${rating!.toStringAsFixed(1)} ($count)',
          style: Theme.of(context).textTheme.bodySmall,
        ),
      ],
    );
  }
}

/// A tappable 1–5 star input for one rating question.
class StarInput extends StatelessWidget {
  const StarInput({super.key, required this.value, required this.onChanged});

  /// 0 means "not answered yet".
  final int value;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        for (var i = 1; i <= 5; i++)
          IconButton(
            visualDensity: VisualDensity.compact,
            padding: EdgeInsets.zero,
            constraints: const BoxConstraints(minWidth: 36, minHeight: 36),
            icon: Icon(
              value >= i ? Icons.star : Icons.star_border,
              color: _starColor,
              size: 30,
            ),
            onPressed: () => onChanged(i),
          ),
      ],
    );
  }
}
