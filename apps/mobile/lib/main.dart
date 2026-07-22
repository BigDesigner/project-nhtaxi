import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'router.dart';

// The exact taxi-yellow from the NH Taxi logo artwork
// (assets/branding/logo-horizontal.png), sampled directly from the asset
// rather than guessed, so every button and accent matches the brand mark.
const _brandAmber = Color(0xFFFCC803);

void main() {
  runApp(const ProviderScope(child: NhTaxiApp()));
}

class NhTaxiApp extends ConsumerWidget {
  const NhTaxiApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'NH Taxi',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        // fromSeed derives the whole palette (secondary/tertiary/surface,
        // used for things like the nav bar's selection indicator) from one
        // hue for harmony. `primary`/`onPrimary` are then forced to the exact
        // brand colours rather than left to the seed algorithm — fromSeed
        // optimises for contrast and would otherwise mute a bright yellow
        // into a dark gold for buttons, which reads as "brownish", not
        // "amber". Black text on amber matches how the logo itself pairs
        // them (black wordmark on the yellow mark).
        colorScheme: ColorScheme.fromSeed(seedColor: _brandAmber).copyWith(
          primary: _brandAmber,
          onPrimary: Colors.black,
        ),
        useMaterial3: true,
      ),
      routerConfig: ref.watch(routerProvider),
    );
  }
}
