import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/router.dart';
import 'package:nhtaxi/widgets/app_back_button.dart';
import 'package:go_router/go_router.dart';

/// Guards the "every screen has a way back" rule.
///
/// This kept regressing: a detail screen would be added as a sibling of
/// /home, reached with `context.go` (which replaces the stack rather than
/// growing it), and the passenger would land somewhere with no back button
/// and no bottom nav. Rather than re-checking by hand each time, these tests
/// fail the build.
void main() {
  group('AppBackButton', () {
    testWidgets('pops when there is somewhere to pop to', (tester) async {
      final router = GoRouter(
        initialLocation: '/home',
        routes: [
          GoRoute(
            path: '/home',
            builder: (_, _) => const Scaffold(body: Text('home')),
            routes: [
              GoRoute(
                path: 'detail',
                builder: (_, _) => Scaffold(
                  appBar: AppBar(leading: const AppBackButton()),
                  body: const Text('detail'),
                ),
              ),
            ],
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      router.go('/home/detail');
      await tester.pumpAndSettle();
      expect(find.text('detail'), findsOneWidget);

      await tester.tap(find.byType(AppBackButton));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });

    testWidgets('falls back to home on a cold deep link', (tester) async {
      // What a web reload (F5) on /home/trip/123 looks like: the screen is
      // built with nothing beneath it, so canPop() is false and AppBar's
      // automatic leading would render nothing at all.
      final router = GoRouter(
        initialLocation: '/home/detail',
        routes: [
          GoRoute(
            path: '/home',
            builder: (_, _) => const Scaffold(body: Text('home')),
            routes: [
              GoRoute(
                path: 'detail',
                builder: (_, _) => Scaffold(
                  appBar: AppBar(leading: const AppBackButton()),
                  body: const Text('detail'),
                ),
              ),
            ],
          ),
        ],
      );
      addTearDown(router.dispose);

      await tester.pumpWidget(MaterialApp.router(routerConfig: router));
      await tester.pumpAndSettle();
      expect(find.text('detail'), findsOneWidget);

      await tester.tap(find.byType(AppBackButton));
      await tester.pumpAndSettle();
      expect(find.text('home'), findsOneWidget);
    });
  });

  group('pre-login routes', () {
    // The bug this pins: the redirect matched '/signup' exactly, so
    // '/signup/driver' counted as a protected page and an anonymous visitor
    // was bounced to /login. The "Drive with us" button looked broken while
    // actually navigating and being sent straight back.
    test('every route under the auth screens is reachable without a session', () {
      final authRoutes = _collectPaths(appRoutes()).where(
        (p) => p == '/login' || p == '/signup' || p.startsWith('/login/') || p.startsWith('/signup/'),
      );

      expect(authRoutes, contains('/signup/driver'), reason: 'driver sign-up should be in the auth subtree');
      for (final path in authRoutes) {
        expect(isPreLoginRoute(path), isTrue, reason: '$path must be reachable while signed out');
      }
    });

    test('protected routes stay protected', () {
      for (final path in [
        '/home',
        '/home/book',
        '/home/drivers',
        '/home/trip/abc',
        '/home/people',
        '/home/activity',
      ]) {
        expect(isPreLoginRoute(path), isFalse, reason: path);
      }
    });

    test('does not treat a lookalike path as pre-login', () {
      // '/signupsomething' shares a prefix with '/signup' but is not under it.
      expect(isPreLoginRoute('/signup-other'), isFalse);
      expect(isPreLoginRoute('/loginish'), isFalse);
    });
  });

  group('app router shape', () {
    test('every passenger screen sits under /home so back always has a target', () {
      // Reads the real route table from lib/router.dart, so a route added to
      // the app without nesting it fails right here.
      final paths = _collectPaths(appRoutes());

      // Two exceptions, both deliberate. The splash and auth screens come
      // before there is any shell to return to; their own subtree (/signup/…)
      // falls back to /login instead.
      const allowedTopLevel = {'/', '/login', '/signup', '/home'};
      final strays = paths.where(
        (p) => !allowedTopLevel.contains(p) && !p.startsWith('/home/') && !p.startsWith('/signup/'),
      );

      expect(
        strays,
        isEmpty,
        reason: 'Detail screens must be children of /home (e.g. /home/book), '
            'or the back button has nothing to return to. Add the route under '
            "the /home GoRoute's `routes:` list and give its AppBar an "
            'AppBackButton leading.',
      );
    });
  });
}

List<String> _collectPaths(List<RouteBase> routes, [String prefix = '']) {
  final out = <String>[];
  for (final route in routes) {
    if (route is! GoRoute) continue;
    final full = route.path.startsWith('/')
        ? route.path
        : '${prefix.endsWith('/') ? prefix : '$prefix/'}${route.path}';
    out.add(full);
    out.addAll(_collectPaths(route.routes, full));
  }
  return out;
}
