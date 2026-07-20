import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

/// A back button that always works.
///
/// `AppBar`'s built-in leading only appears when there's something on the
/// navigation stack to pop. That fails in two ordinary cases:
///
///  * on the web build, opening or reloading a deep link (`/home/trip/123`)
///    starts with an empty stack, so the automatic button never renders;
///  * anywhere we navigate with `context.go`, which replaces the stack
///    rather than growing it.
///
/// Both left passengers stranded on a screen with no way back. This falls
/// back to the home shell whenever popping isn't possible, so every detail
/// screen has a guaranteed exit regardless of how it was reached.
///
/// Every screen outside the bottom-nav shell must set this as its AppBar
/// `leading` — `router_test.dart` fails the build if a new route is added
/// without one.
class AppBackButton extends StatelessWidget {
  const AppBackButton({super.key, this.fallbackLocation = '/home'});

  /// Where to go when there is no stack entry to return to.
  final String fallbackLocation;

  @override
  Widget build(BuildContext context) {
    return IconButton(
      icon: const BackButtonIcon(),
      tooltip: MaterialLocalizations.of(context).backButtonTooltip,
      onPressed: () {
        final router = GoRouter.of(context);
        if (router.canPop()) {
          router.pop();
        } else {
          router.go(fallbackLocation);
        }
      },
    );
  }
}
