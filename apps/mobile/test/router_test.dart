import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:gnncab/router.dart';
import 'package:gnncab/widgets/app_back_button.dart';
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

  group('app router shape', () {
    test('every passenger screen sits under /home so back always has a target', () {
      // Reads the real route table from lib/router.dart, so a route added to
      // the app without nesting it fails right here.
      final paths = _collectPaths(appRoutes());

      // Auth screens and the splash are the deliberate exceptions: there is
      // no shell to go back to before signing in.
      const allowedTopLevel = {'/', '/login', '/signup', '/home'};
      final strays = paths.where((p) => !allowedTopLevel.contains(p) && !p.startsWith('/home/'));

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
