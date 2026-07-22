import 'package:flutter/material.dart';

/// The horizontal NH Taxi wordmark, used wherever the app shows its own
/// branding rather than a screen-specific title (login screen, the home tab's
/// app bar). Transparent PNG, so it sits on any background colour — unlike
/// the app icon, which must be opaque (App Store rejects a transparent one).
class BrandLogo extends StatelessWidget {
  const BrandLogo({super.key, this.height = 28});

  final double height;

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      'assets/branding/logo-horizontal.png',
      height: height,
      fit: BoxFit.contain,
    );
  }
}
