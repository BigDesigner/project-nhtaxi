import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/providers.dart';
import '../../core/push_tokens.dart';
import '../../legal/terms.dart';
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
      // Cold start with a session already in place — the device may not be
      // registered for push, or may have been issued a new token since.
      unawaited(ref.read(pushTokenServiceProvider).register());
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
          // The API requires this to be literally true — there is no way to
          // create an account without having accepted the terms.
          'acceptedTerms': true,
          'acceptedTermsVersion': termsVersion,
          'platform': AppConfig.authPlatform,
        },
        skipAuth: true,
      );
      return _persistSession(json);
    });
  }

  /// Driver sign-up. Separate endpoint from [register] because it creates a
  /// driver profile alongside the user and requires explicit agreement to the
  /// driver terms — `acceptedAgreement` has to be literally true server-side,
  /// so there is no way to sign someone up by implication.
  ///
  /// Vehicle details are optional here: getting a driver signed up quickly
  /// matters more than a complete record, and the app nags for the missing
  /// pieces on the home tab until they're filled in.
  Future<void> registerDriver({
    required String firstName,
    required String lastName,
    required String email,
    required String phone,
    required String password,
    String? vehicleMake,
    String? vehicleModel,
    String? vehicleColor,
    String? vehiclePlate,
    int? vehicleYear,
    String? licenseNumber,
  }) async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(() async {
      final json = await ref.read(apiClientProvider).post(
        '/api/driver/register',
        body: {
          'firstName': firstName,
          'lastName': lastName,
          'email': email,
          'phone': phone,
          'password': password,
          'acceptedAgreement': true,
          'acceptedTermsVersion': termsVersion,
          if (vehicleMake != null && vehicleMake.isNotEmpty) 'vehicleMake': vehicleMake,
          if (vehicleModel != null && vehicleModel.isNotEmpty) 'vehicleModel': vehicleModel,
          if (vehicleColor != null && vehicleColor.isNotEmpty) 'vehicleColor': vehicleColor,
          if (vehiclePlate != null && vehiclePlate.isNotEmpty) 'vehiclePlate': vehiclePlate,
          'vehicleYear': ?vehicleYear,
          if (licenseNumber != null && licenseNumber.isNotEmpty) 'licenseNumber': licenseNumber,
          'platform': AppConfig.authPlatform,
        },
        skipAuth: true,
      );
      return _persistSession(json);
    });
  }

  Future<void> logout() async {
    // Before anything else: the API identifies the token by who is asking, so
    // this needs a live session. Otherwise a handed-on phone keeps getting the
    // previous user's trip notifications.
    await ref.read(pushTokenServiceProvider).unregister();

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
    // Every path that creates a session lands here, so registering once here
    // covers login, passenger sign-up and driver sign-up alike.
    unawaited(ref.read(pushTokenServiceProvider).register());
    return AppUser.fromJson(json['user'] as Map<String, dynamic>);
  }
}

final authControllerProvider = AsyncNotifierProvider<AuthController, AppUser?>(AuthController.new);
