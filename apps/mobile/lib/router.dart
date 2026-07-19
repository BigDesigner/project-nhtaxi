import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'features/auth/auth_controller.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/signup_screen.dart';
import 'features/passenger/active_trip_screen.dart';
import 'features/passenger/booking/booking_screen.dart';
import 'features/passenger/passenger_home_screen.dart';

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
    routes: [
      GoRoute(path: '/', builder: (_, _) => const _SplashScreen()),
      GoRoute(path: '/login', builder: (_, _) => const LoginScreen()),
      GoRoute(path: '/signup', builder: (_, _) => const SignupScreen()),
      GoRoute(path: '/home', builder: (_, _) => const _RoleHome()),
      GoRoute(path: '/book', builder: (_, _) => const BookingScreen()),
      GoRoute(
        path: '/trip/:tripId',
        builder: (_, state) => ActiveTripScreen(tripId: state.pathParameters['tripId']!),
      ),
    ],
  );
});

/// Sends each role to its own surface. Only the passenger app exists in this
/// wave; driver and admin are stubbed so signing in with those accounts is
/// explicable rather than broken.
class _RoleHome extends ConsumerWidget {
  const _RoleHome();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(authControllerProvider).value;
    if (user == null) return const _SplashScreen();
    if (user.isCustomer) return const PassengerHomeScreen();
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
            onPressed: () => ref.read(authControllerProvider.notifier).logout(),
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
