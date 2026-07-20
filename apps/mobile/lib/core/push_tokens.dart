import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api_client.dart';
import 'config.dart';
import 'providers.dart';

/// Registers this device for push notifications, and unregisters it on
/// logout.
///
/// ## Why this exists as a seam rather than a Firebase call
///
/// The server side of push has been finished and deployed since Faz 6:
/// `push_tokens` storage, FCM HTTP v1 sending signed with Web Crypto, and
/// notifications wired into every trip transition. None of it has ever
/// delivered anything, because **no device has ever registered a token** —
/// the app had no push client at all. That was recorded as "waiting for the
/// Firebase key", which understated it: supplying the key alone would still
/// have delivered nothing.
///
/// Adding `firebase_messaging` outright is not possible from here either. The
/// Android build needs a `google-services.json` generated from a specific
/// Firebase project, and adding the plugin without it fails the APK build in
/// CI. So this owns everything that *isn't* Firebase — talking to our own
/// API, choosing when to register, and unregistering cleanly — behind a
/// [DeviceTokenSource] that returns null until Firebase is wired up.
///
/// ## To turn push on (all three steps are needed)
///
/// 1. Create the Firebase project, add Android/iOS/web apps to it, and run
///    `flutterfire configure` — this writes `firebase_options.dart` and
///    `google-services.json`.
/// 2. Add `firebase_core` + `firebase_messaging` to pubspec, then replace
///    [devicetokenSourceProvider] with one that returns
///    `FirebaseMessaging.instance.getToken()` after requesting permission.
/// 3. Put the service-account JSON in the `FCM_SERVICE_ACCOUNT_KEY` Worker
///    secret so the server can sign its sends.
///
/// Until then this is a deliberate, documented no-op — not a silent one.

/// Where the device's push token comes from.
abstract class DeviceTokenSource {
  /// Null means "push isn't configured on this build", which is a normal
  /// state, not an error. Callers must treat it as "skip", never as failure.
  Future<String?> currentToken();
}

/// The stand-in used until Firebase is wired up.
class UnconfiguredTokenSource implements DeviceTokenSource {
  const UnconfiguredTokenSource();

  @override
  Future<String?> currentToken() async => null;
}

final deviceTokenSourceProvider = Provider<DeviceTokenSource>(
  (ref) => const UnconfiguredTokenSource(),
);

class PushTokenService {
  PushTokenService(this._ref);

  final Ref _ref;

  /// The token this device last registered, so logout can unregister exactly
  /// that one rather than guessing.
  String? _registered;

  /// Called after a successful sign-in, and on cold start when a session
  /// already exists.
  ///
  /// Best-effort throughout: a passenger whose notifications fail to register
  /// should still get their taxi. Failures are swallowed rather than surfaced.
  Future<void> register() async {
    try {
      final token = await _ref.read(deviceTokenSourceProvider).currentToken();
      if (token == null) return;

      await _ref.read(apiClientProvider).post(
        '/api/push-tokens',
        body: {'token': token, 'platform': AppConfig.authPlatform},
      );
      _registered = token;
    } on ApiException {
      // Nothing the user can act on, and nothing worth blocking them for.
    }
  }

  /// Called *before* the session is torn down — the API needs the caller to
  /// still be authenticated to know whose token this is.
  ///
  /// Without this, a shared or handed-on device keeps receiving the previous
  /// user's trip notifications.
  Future<void> unregister() async {
    final token = _registered;
    if (token == null) return;

    try {
      await _ref.read(apiClientProvider).delete('/api/push-tokens', body: {'token': token});
    } on ApiException {
      // The server also reassigns a token when it re-registers under a new
      // user, so a failure here is recoverable rather than permanent.
    } finally {
      _registered = null;
    }
  }
}

final pushTokenServiceProvider = Provider<PushTokenService>(PushTokenService.new);
