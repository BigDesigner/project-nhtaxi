import 'package:flutter/material.dart';

/// Pickup and destination markers, built to stand out against a busy
/// OpenStreetMap tile.
///
/// Plain `Icon`s were getting lost against road lines and building fills. The
/// shared treatment here is what makes them readable: a white ring separating
/// the marker from whatever is under it, and a drop shadow so the ring itself
/// stays visible on pale tiles. Pickup additionally pulses, because it is the
/// point the passenger is being asked to confirm.

const _pickupColor = Color(0xFF16A34A); // green 600
const _destinationColor = Color(0xFFDC2626); // red 600

/// A green dot with a slow expanding halo — "we are here, confirm this".
///
/// The animation runs indefinitely, so only use it where a marker is the
/// subject of the screen. Sized 56×56; give the enclosing `Marker` that size
/// or the halo gets clipped at its widest.
class PickupMarker extends StatefulWidget {
  const PickupMarker({super.key});

  @override
  State<PickupMarker> createState() => _PickupMarkerState();
}

class _PickupMarkerState extends State<PickupMarker> with SingleTickerProviderStateMixin {
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
                  decoration: const BoxDecoration(color: _pickupColor, shape: BoxShape.circle),
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
            color: _pickupColor,
            shape: BoxShape.circle,
            border: Border.all(color: Colors.white, width: 3),
            boxShadow: const [BoxShadow(color: Colors.black38, blurRadius: 6, offset: Offset(0, 2))],
          ),
        ),
      ),
    );
  }
}

/// A teardrop pin whose *tip* marks the spot, not its centre.
///
/// Anchor it by giving the enclosing `Marker` `alignment: Alignment.topCenter`
/// so the tip lands on the coordinate rather than the middle of the shape.
class DestinationMarker extends StatelessWidget {
  const DestinationMarker({super.key, this.size = 48});

  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Drawn as a stack of two icons: the filled pin sitting on top of a
          // slightly larger white one, which produces the outline. Cheaper and
          // sharper at any size than a custom painter.
          Icon(Icons.location_on, size: size, color: Colors.white),
          Icon(Icons.location_on, size: size - 6, color: _destinationColor),
          // The white dot in the pin's head, so it reads as a marker rather
          // than a solid blob at small sizes.
          Padding(
            padding: EdgeInsets.only(bottom: size * 0.28),
            child: Container(
              width: size * 0.18,
              height: size * 0.18,
              decoration: const BoxDecoration(color: Colors.white, shape: BoxShape.circle),
            ),
          ),
        ],
      ),
    );
  }
}

/// The small inline dot used in list rows and address fields, matching the
/// map colours so the two read as the same thing.
class LegendDot extends StatelessWidget {
  const LegendDot({super.key, required this.isPickup});

  final bool isPickup;

  @override
  Widget build(BuildContext context) {
    final color = isPickup ? _pickupColor : _destinationColor;
    return isPickup
        ? Container(
            width: 14,
            height: 14,
            decoration: BoxDecoration(
              color: color,
              shape: BoxShape.circle,
              border: Border.all(color: Colors.white, width: 2.5),
              boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 3)],
            ),
          )
        : Icon(Icons.location_on, size: 20, color: color);
  }
}
