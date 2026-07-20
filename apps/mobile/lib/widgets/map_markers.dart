import 'package:flutter/material.dart';

/// Pickup and destination markers, built to stand out against a busy
/// OpenStreetMap tile.
///
/// Deliberately drawn from plain shapes rather than `Icon`s. An earlier
/// version stacked `Icons.location_on` glyphs for the destination pin and it
/// rendered as nothing on the web build — the icon font was reaching the
/// browser without some of the glyphs, so all that showed was the plain
/// `Container` layered on top. Shapes have no font dependency and cannot
/// vanish that way.
///
/// The shared treatment is what makes them readable: a white ring separating
/// the marker from whatever is under it, and a drop shadow so the ring itself
/// stays visible on pale tiles. Both pulse — they mark the two ends of the
/// trip and should read as a matched pair, differing only in colour.

const pickupColor = Color(0xFF16A34A); // green 600
const destinationColor = Color(0xFFDC2626); // red 600

/// A pulsing dot with an expanding halo. Green marks the pickup, red the
/// destination.
///
/// Sized 56×56; give the enclosing `Marker` that size or the halo gets
/// clipped at its widest. The animation runs indefinitely, so only use it
/// where the marker is the subject of the screen.
class TripPointMarker extends StatefulWidget {
  const TripPointMarker({super.key, required this.isPickup});

  const TripPointMarker.pickup({Key? key}) : this(key: key, isPickup: true);
  const TripPointMarker.destination({Key? key}) : this(key: key, isPickup: false);

  final bool isPickup;

  @override
  State<TripPointMarker> createState() => _TripPointMarkerState();
}

class _TripPointMarkerState extends State<TripPointMarker> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1800),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final color = widget.isPickup ? pickupColor : destinationColor;

    return SizedBox(
      width: 56,
      height: 56,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) {
          final t = _controller.value;
          return Stack(
            alignment: Alignment.center,
            children: [
              // Halo: grows outward and fades as it goes, like a sonar ping.
              Opacity(
                opacity: (1 - t) * 0.45,
                child: Container(
                  width: 20 + (36 * t),
                  height: 20 + (36 * t),
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                ),
              ),
              child!,
            ],
          );
        },
        // The dot itself never animates, so it's built once and reused.
        child: Container(
          width: 22,
          height: 22,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6, offset: Offset(0, 2))],
          ),
        ),
      ),
    );
  }
}

/// The small static dot used in list rows and address fields, matching the map
/// colours so the two read as the same thing. Same shapes, no animation.
class LegendDot extends StatelessWidget {
  const LegendDot({super.key, required this.isPickup});

  final bool isPickup;

  @override
  Widget build(BuildContext context) {
    final color = isPickup ? pickupColor : destinationColor;
    return Container(
      width: 14,
      height: 14,
      decoration: BoxDecoration(
        color: color,
        shape: BoxShape.circle,
        border: Border.all(color: Colors.white, width: 2.5),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)],
      ),
    );
  }
}
