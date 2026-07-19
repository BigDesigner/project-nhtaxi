import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/providers.dart';
import '../../models/user.dart';

/// Holds the signed-in user, or null when logged out.
///
/// `build()` is the source of truth on cold start: if a token survives in
/// secure storage we validate it against /auth/me rather than trusting it
/// blindly, so a revoked or expired session drops straight to logged-out.
class AuthController extends AsyncNotifier<AppUser?> {
  @override
  Future<AppUser?> build() async {
    final hasToken = await ref.watch(tokenStoreProvider).hasSession();
    if (!hasToken) return null;

    try {
      final json = await ref.read(apiClientProvider).get('/api/auth/me');
      return AppUser.fromJson(json);
    } on ApiException {
      // Token is present but no longer valid — treat as logged out.
      await ref.read(tokenStoreProvider).clear();
      return null;
    }
  }

  Future<void> login({required String email, required String password}) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final json = await ref.read(apiClientProvider).post(
        '/api/auth/login',
        body: {'email': email, 'password': password, 'platform': AppConfig.authPlatform},
        skipAuth: true,
      );
      return _persistSession(json);
    });
  }

  Future<void> register({
    required String firstName,
    required String lastName,
    required String email,
    required String phone,
    required String password,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final json = await ref.read(apiClientProvider).post(
        '/api/auth/register',
        body: {
          'firstName': firstName,
          'lastName': lastName,
          'email': email,
          'phone': phone,
          'password': password,
          'platform': AppConfig.authPlatform,
        },
        skipAuth: true,
      );
      return _persistSession(json);
    });
  }

  Future<void> logout() async {
    final tokenStore = ref.read(tokenStoreProvider);
    final refreshToken = await tokenStore.readRefreshToken();
    try {
      // Best effort: revokes the refresh token server-side so the session
      // can't be resumed. A failure here still logs us out locally.
      await ref.read(apiClientProvider).post(
        '/api/auth/logout',
        body: {'refreshToken': refreshToken, 'platform': AppConfig.authPlatform},
      );
    } on ApiException {
      // Ignore — local logout below is what the user asked for.
    }
    await tokenStore.clear();
    state = const AsyncData(null);
  }

  Future<AppUser> _persistSession(Map<String, dynamic> json) async {
    final accessToken = json['accessToken'] as String?;
    final refreshToken = json['refreshToken'] as String?;
    if (accessToken == null || refreshToken == null) {
      // Only happens if we ever identified as platform "web", where the API
      // deliberately withholds tokens and sets cookies instead.
      throw ApiException('Server did not return a session token');
    }
    await ref.read(tokenStoreProvider).save(accessToken: accessToken, refreshToken: refreshToken);
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, AppUser?>(AuthController.new);
