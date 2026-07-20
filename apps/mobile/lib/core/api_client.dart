import 'package:dio/dio.dart';

import 'config.dart';
import 'token_store.dart';

/// Thrown for API errors we want the UI to show verbatim (the backend's
/// `{ error, message }` shape).
class ApiException implements Exception {
  ApiException(this.message, {this.statusCode});

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

/// Dio wrapper that attaches the Bearer token and transparently rotates it
/// on a 401.
///
/// The access token lives 15 minutes, so mid-session expiry is the normal
/// case, not an edge case — a 401 triggers one refresh + retry before the
/// user ever sees an error. If the refresh itself fails the session is
/// genuinely dead: tokens are cleared and [onSessionExpired] fires so the
/// router can bounce to login.
class ApiClient {
  ApiClient(this._tokenStore, {Dio? dio, this.onSessionExpired}) : _dio = dio ?? Dio() {
    _dio.options
      ..baseUrl = AppConfig.apiBaseUrl
      ..connectTimeout = const Duration(seconds: 15)
      ..receiveTimeout = const Duration(seconds: 20)
      // Let non-2xx through to the error interceptor rather than throwing
      // on status alone, so we can read the backend's error message.
      ..validateStatus = (status) => status != null && status < 500;

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['skipAuth'] != true) {
            final token = await _tokenStore.readAccessToken();
            if (token != null) options.headers['Authorization'] = 'Bearer $token';
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio _dio;
  final TokenStore _tokenStore;
  final void Function()? onSessionExpired;

  /// Single-flight guard: several requests can 401 at once, and they must
  /// share one rotation rather than each burning the (single-use) refresh
  /// token and invalidating each other.
  Future<bool>? _pendingRefresh;

  Future<Map<String, dynamic>> get(String path, {Map<String, dynamic>? query}) =>
      _send(() => _dio.get<dynamic>(path, queryParameters: query));

  Future<Map<String, dynamic>> post(String path, {Object? body, bool skipAuth = false}) => _send(
        () => _dio.post<dynamic>(path, data: body, options: Options(extra: {'skipAuth': skipAuth})),
        // An unauthenticated call can't have an expired session, so a 401
        // from it is a real answer ("wrong password"), not a stale token.
        allowRefresh: !skipAuth,
      );

  Future<Map<String, dynamic>> put(String path, {Object? body}) =>
      _send(() => _dio.put<dynamic>(path, data: body));

  Future<List<dynamic>> getList(String path, {Map<String, dynamic>? query}) async {
    final response = await _raw(() => _dio.get<dynamic>(path, queryParameters: query));
    final data = response.data;
    if (data is List) return data;
    throw ApiException('Expected a list from $path');
  }

  Future<Map<String, dynamic>> _send(
    Future<Response<dynamic>> Function() request, {
    bool allowRefresh = true,
  }) async {
    final response = await _raw(request, allowRefresh: allowRefresh);
    final data = response.data;
    if (data is Map<String, dynamic>) return data;
    return <String, dynamic>{};
  }

  Future<Response<dynamic>> _raw(
    Future<Response<dynamic>> Function() request, {
    bool allowRefresh = true,
  }) async {
    Response<dynamic> response;
    try {
      response = await request();
    } on DioException catch (e) {
      throw ApiException(_networkMessage(e));
    }

    if (allowRefresh && response.statusCode == 401 && await _refreshSession()) {
      try {
        response = await request();
      } on DioException catch (e) {
        throw ApiException(_networkMessage(e));
      }
    }

    if ((response.statusCode ?? 500) >= 400) {
      throw ApiException(_errorMessage(response), statusCode: response.statusCode);
    }
    return response;
  }

  Future<bool> _refreshSession() {
    return _pendingRefresh ??= _doRefresh().whenComplete(() => _pendingRefresh = null);
  }

  Future<bool> _doRefresh() async {
    final refreshToken = await _tokenStore.readRefreshToken();
    if (refreshToken == null) {
      await _endSession();
      return false;
    }

    try {
      final response = await _dio.post<dynamic>(
        '/api/auth/refresh',
        data: {'refreshToken': refreshToken, 'platform': AppConfig.authPlatform},
        options: Options(extra: {'skipAuth': true}),
      );
      final data = response.data;
      if (response.statusCode == 200 && data is Map<String, dynamic>) {
        final access = data['accessToken'] as String?;
        final refresh = data['refreshToken'] as String?;
        if (access != null && refresh != null) {
          await _tokenStore.save(accessToken: access, refreshToken: refresh);
          return true;
        }
      }
    } on DioException {
      // Fall through to ending the session.
    }

    await _endSession();
    return false;
  }

  Future<void> _endSession() async {
    // Only signal expiry if there was actually a session to lose. Firing this
    // otherwise would reset the auth controller mid-login and wipe the error
    // the user needs to see.
    final hadSession = await _tokenStore.hasSession();
    await _tokenStore.clear();
    if (hadSession) onSessionExpired?.call();
  }

  String _errorMessage(Response<dynamic> response) {
    final data = response.data;
    if (data is Map && data['message'] is String) return data['message'] as String;
    return 'Request failed (${response.statusCode})';
  }

  String _networkMessage(DioException e) {
    if (e.type == DioExceptionType.connectionTimeout ||
        e.type == DioExceptionType.receiveTimeout ||
        e.type == DioExceptionType.connectionError) {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    return e.message ?? 'Network error';
  }
}
