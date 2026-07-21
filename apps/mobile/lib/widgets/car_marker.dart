import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A top-view car for the map, pointing in the driver's direction of travel.
///
/// Drawn as vector paths with a CustomPainter rather than an SVG asset or icon
/// font — the same call `widgets/map_markers.dart` already makes, and for the
/// same reason: web release builds subset icon fonts and drop in-use glyphs,
/// so anything that renders from a glyph can silently vanish. Pure paths can't.
///
/// The base drawing faces "up" (front at the top). [headingDegrees] rotates
/// it clockwise from north — 0/null points up, 90 east, 180 down — so the car
/// nose lines up with the bearing the driver is actually moving along. A null
/// heading (a snapshot map with no movement history, or a driver who hasn't
/// moved yet) just leaves it pointing up rather than guessing.
class CarMarker extends StatelessWidget {
  const CarMarker({super.key, required this.color, this.headingDegrees, this.size = 34});

  final Color color;
  final double? headingDegrees;
  final double size;

  @override
  Widget build(BuildContext context) {
    return Transform.rotate(
      angle: (headingDegrees ?? 0) * math.pi / 180,
      child: CustomPaint(size: Size.square(size), painter: _CarPainter(color)),
    );
  }
}

class _CarPainter extends CustomPainter {
  _CarPainter(this.color);

  final Color color;

  // Design space: a 48-wide × 64-long top-view car, front at the top. Every
  // coordinate below is in this space and mapped into the square marker box,
  // so the shape reads the same at any size.
  static const _designW = 48.0;
  static const _designH = 64.0;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.shortestSide;
    // Fit the car's length to ~90% of the box, centred, leaving room so the
    // rotated corners never clip against the box edge.
    final scale = (0.9 * s) / _designH;
    final carW = _designW * scale;
    final carH = _designH * scale;
    final ox = (s - carW) / 2;
    final oy = (s - carH) / 2;
    Offset p(double x, double y) => Offset(ox + x * scale, oy + y * scale);
    Rect r(double x1, double y1, double x2, double y2) => Rect.fromPoints(p(x1, y1), p(x2, y2));
    RRect rr(double x1, double y1, double x2, double y2, double radius) =>
        RRect.fromRectAndRadius(r(x1, y1, x2, y2), Radius.circular(radius * scale));

    final glass = const Color(0xFFB9D6E8);
    final roof = Color.lerp(color, Colors.black, 0.28)!;
    final wheel = const Color(0xFF262626);
    final headlight = const Color(0xFFFFF3C4);

    final body = rr(8, 4, 40, 60, 11);

    // Soft drop shadow so the car stands off busy map tiles.
    canvas.drawRRect(
      body.shift(const Offset(0, 1.5)),
      Paint()
        ..color = Colors.black.withValues(alpha: 0.35)
        ..maskFilter = MaskFilter.blur(BlurStyle.normal, 2 * scale),
    );

    // Wheels first, so the body sits over their inner edges.
    final wheelPaint = Paint()..color = wheel;
    for (final w in [rr(3, 13, 11, 27, 3), rr(37, 13, 45, 27, 3), rr(3, 40, 11, 54, 3), rr(37, 40, 45, 54, 3)]) {
      canvas.drawRRect(w, wheelPaint);
    }

    // Body + white outline (the outline is what keeps it legible on any tile).
    canvas.drawRRect(body, Paint()..color = color);
    canvas.drawRRect(body, Paint()..color = Colors.white..style = PaintingStyle.stroke..strokeWidth = 1.8 * scale);

    // Windshield — a trapezoid just behind the hood, narrower toward the front.
    final windshield = Path()
      ..moveTo(p(16, 20).dx, p(16, 20).dy)
      ..lineTo(p(32, 20).dx, p(32, 20).dy)
      ..lineTo(p(34, 30).dx, p(34, 30).dy)
      ..lineTo(p(14, 30).dx, p(14, 30).dy)
      ..close();
    canvas.drawPath(windshield, Paint()..color = glass);

    // Cabin roof.
    canvas.drawRRect(rr(13, 30, 35, 46, 4), Paint()..color = roof);

    // Rear window.
    final rear = Path()
      ..moveTo(p(15, 46).dx, p(15, 46).dy)
      ..lineTo(p(33, 46).dx, p(33, 46).dy)
      ..lineTo(p(31, 54).dx, p(31, 54).dy)
      ..lineTo(p(17, 54).dx, p(17, 54).dy)
      ..close();
    canvas.drawPath(rear, Paint()..color = glass.withValues(alpha: 0.75));

    // Two headlights at the very front — the cue that reads "this end leads",
    // which is what makes the rotation legible at a glance.
    final hlPaint = Paint()..color = headlight;
    canvas.drawRRect(rr(12, 6, 19, 10, 2), hlPaint);
    canvas.drawRRect(rr(29, 6, 36, 10, 2), hlPaint);
  }

  @override
  bool shouldRepaint(_CarPainter old) => old.color != color;
}
