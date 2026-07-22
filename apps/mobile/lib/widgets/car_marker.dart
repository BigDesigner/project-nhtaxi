import 'dart:math' as math;

import 'package:flutter/material.dart';

/// A top-view car for the map, turned to the driver's direction of travel.
///
/// The car is a PNG asset (`assets/markers/car.png`) drawn nose-up, so
/// [headingDegrees] rotates it directly: 0/null points up (north), 90 east,
/// 180 down, 270 west. A null heading — a snapshot map, or a driver who
/// hasn't moved yet — just leaves it pointing up rather than guessing.
///
/// [color] is a small status pip in the corner (green available, red busy,
/// amber reserved), not the car's own colour — the car keeps its taxi look at
/// every status. The pip does *not* rotate with the car: availability isn't
/// directional.
class CarMarker extends StatelessWidget {
  const CarMarker({super.key, required this.color, this.headingDegrees, this.size = 42});

  final Color color;
  final double? headingDegrees;
  final double size;

  @override
  Widget build(BuildContext context) {
    final pip = size * 0.26;
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          Transform.rotate(
            angle: (headingDegrees ?? 0) * math.pi / 180,
            child: Image.asset(
              'assets/markers/car.png',
              height: size,
              fit: BoxFit.contain,
              filterQuality: FilterQuality.medium,
            ),
          ),
          Positioned(
            top: 0,
            right: 0,
            child: Container(
              width: pip,
              height: pip,
              decoration: BoxDecoration(
                color: color,
                shape: BoxShape.circle,
                border: Border.all(color: Colors.white, width: 1.5),
                boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 2)],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
