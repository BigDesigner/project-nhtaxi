import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nhtaxi/core/providers.dart';
import 'package:nhtaxi/core/token_store.dart';
import 'package:nhtaxi/features/auth/login_screen.dart';
import 'package:nhtaxi/widgets/brand_logo.dart';

void main() {
  /// The auth controller reads persisted tokens on build, which in production
  /// means platform channels that don't exist in a headless test. Injecting
  /// an empty in-memory store resolves auth to "logged out" immediately, so
  /// the form renders in its normal (not loading) state.
  Widget wrap(Widget child) => ProviderScope(
        overrides: [
          tokenStoreProvider.overrideWithValue(TokenStore(store: InMemorySecretStore())),
        ],
        child: MaterialApp(home: child),
      );

  testWidgets('login form renders its fields', (tester) async {
    await tester.pumpWidget(wrap(const LoginScreen()));
    await tester.pumpAndSettle();

    expect(find.byType(BrandLogo), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Email'), findsOneWidget);
    expect(find.widgetWithText(TextFormField, 'Password'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Sign in'), findsOneWidget);
  });

  // Client-side validation matters beyond UX here: it stops obviously-bad
  // credentials from burning a round trip to the Worker.
  testWidgets('login form rejects a malformed email before submitting', (tester) async {
    await tester.pumpWidget(wrap(const LoginScreen()));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'not-an-email');
    await tester.enterText(find.widgetWithText(TextFormField, 'Password'), 'correct horse battery');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();

    expect(find.text('Enter a valid email'), findsOneWidget);
  });

  testWidgets('login form requires a password', (tester) async {
    await tester.pumpWidget(wrap(const LoginScreen()));
    await tester.pumpAndSettle();

    await tester.enterText(find.widgetWithText(TextFormField, 'Email'), 'pat@example.com');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pump();

    expect(find.text('Enter your password'), findsOneWidget);
  });
}
