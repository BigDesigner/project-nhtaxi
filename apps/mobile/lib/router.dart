import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/driver_signup_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/signup_screen.dart';
import 'features/driver/driver_job_screen.dart';
import 'features/driver/driver_shell.dart';
import 'features/passenger/active_trip_screen.dart';
import 'features/passenger/booking/booking_screen.dart';
import 'features/passenger/drivers/drivers_screen.dart';
import 'features/passenger/passenger_shell.dart';

/// The app's route table.
///
/// Exposed separately from [routerProvider] so `router_test.dart` can assert
/// its shape without needing a ProviderScope or a live auth state — the test
/// reads *this* list, so a route added here can't slip past the guard.
///
/// **Every passenger screen outside the bottom-nav shell must be a child of
/// `/home`.** Navigating with `context.go` replaces the stack rather than
/// growing it, so a detail screen declared as a sibling of `/home` leaves
/// nothing beneath it and the passenger has no way back. Nesting guarantees
/// home is always underneath. Pair it with `AppBackButton` as the screen's
/// AppBar `leading`, which also covers a cold deep link (web reload) where
/// there is genuinely no stack to pop.
List<RouteBase> appRoutes() => [
      GoRoute(path: '/', builder: (_, _) => const _SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(
        path: '/signup',
        builder: (_, _) => const SignupScreen(),
        // Driver sign-up is a sibling of passenger sign-up rather than a
        // separate top-level screen: same pre-login area, and back lands on
        // the passenger form it was reached from.
        routes: [
          GoRoute(path: 'driver', builder: (_, _) => const DriverSignupScreen()),
        ],
      ),
      GoRoute(
        path: '/home',
        builder: (_, _) => const _RoleHome(),
        routes: [
          GoRoute(path: 'book', builder: (_, _) => const BookingScreen()),
          GoRoute(path: 'drivers', builder: (_, _) => const DriversScreen()),
          GoRoute(
            path: 'trip/:tripId',
            builder: (_, state) => ActiveTripScreen(tripId: state.pathParameters['tripId']!),
          ),
          // Driver-side detail screen. Shares /home so the role shell is
          // always underneath it, exactly like the passenger's.
          GoRoute(
            path: 'job/:tripId',
            builder: (_, state) => DriverJobScreen(tripId: state.pathParameters['tripId']!),
          ),
        ],
      ),
    ];

final routerProvider = Provider<GoRouter>((ref) {
  // go_router needs a plain Listenable to re-run redirects; this bridges
  // Riverpod's auth state onto one. Bumping the value is enough — the
  // redirect callback reads the real state itself.
  final refresh = ValueNotifier<int>(0);
  ref.listen(authControllerProvider, (_, _) => refresh.value++);
  ref.onDispose(refresh.dispose);

  return GoRouter(
    initialLocation: '/',
    refreshListenable: refresh,
    redirect: (context, state) {
      final auth = ref.read(authControllerProvider);
      final path = state.matchedLocation;

      // Cold start: we're validating a stored token against /auth/me. Hold
      // on the splash rather than flashing the login screen at someone who
      // turns out to be signed in.
      if (auth.isLoading) return path == '/' ? null : '/';

      final user = auth.value;
      final isAuthRoute = path == '/login' || path == '/signup';

      if (user == null) return isAuthRoute ? null : '/login';
      if (isAuthRoute || path == '/') return '/home';
      return null;
    },
    routes: appRoutes(),
  );
});

/// Sends each role to its own surface. Passenger and driver apps both exist;
/// admin is still stubbed so signing in with that account is explicable
/// rather than broken.
class _RoleHome extends ConsumerWidget {
  const _RoleHome();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    if (user == null) return const _SplashScreen();
    if (user.isCustomer) return const PassengerShell();
    if (user.role == 'driver') return const DriverShell();
    return _ComingSoonScreen(role: user.role);
  }
}

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(body: Center(child: CircularProgressIndicator()));
  }
}

class _ComingSoonScreen extends ConsumerWidget {
  const _ComingSoonScreen({required this.role});

  final String role;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('GNNcab'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            icon: const Icon(Icons.logout),
            onPressed: () => confirmSignOut(context, ref),
          ),
        ],
      ),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.construction, size: 48),
              const SizedBox(height: 16),
              Text(
                'The $role app is coming soon',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.titleMedium,
              ),
              const SizedBox(height: 8),
              Text(
                'Your account works — this surface just is not built yet.',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
