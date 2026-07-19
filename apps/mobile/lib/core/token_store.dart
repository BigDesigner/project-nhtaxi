import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Minimal key/value contract behind [TokenStore].
///
/// Exists so tests (and the widget tests in particular) can run without the
/// platform channels `flutter_secure_storage` needs — there is no secure
/// enclave in a headless test binding.
abstract class SecretStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);
}

class SecureStorageSecretStore implements SecretStore {
  const SecureStorageSecretStore([this._storage = const FlutterSecureStorage()]);

  final FlutterSecureStorage _storage;

  @override
  Future<String?> read(String key) => _storage.read(key: key);

  @override
  Future<void> write(String key, String value) => _storage.write(key: key, value: value);

  @override
  Future<void> delete(String key) => _storage.delete(key: key);
}

/// In-memory stand-in for tests. Never use outside tests — it is not secure
/// and does not persist.
class InMemorySecretStore implements SecretStore {
  final Map<String, String> _values = {};

  @override
  Future<String?> read(String key) async => _values[key];

  @override
  Future<void> write(String key, String value) async => _values[key] = value;

  @override
  Future<void> delete(String key) async => _values.remove(key);
}

/// Persists the access + refresh token pair.
///
/// Backed by Keychain (iOS) / Android Keystore in production. On Flutter Web
/// this degrades to browser storage, which is readable by any XSS on the
/// page — acceptable only because the web build is a dev/test preview (L32),
/// never the production passenger surface. Revisit before ever promoting web
/// to a real user-facing target.
class TokenStore {
  TokenStore({SecretStore? store}) : _store = store ?? const SecureStorageSecretStore();

  final SecretStore _store;

  static const _accessKey = 'gnncab_access_token';
  static const _refreshKey = 'gnncab_refresh_token';

  Future<String?> readAccessToken() => _store.read(_accessKey);
  Future<String?> readRefreshToken() => _store.read(_refreshKey);

  Future<void> save({required String accessToken, required String refreshToken}) async {
    await _store.write(_accessKey, accessToken);
    await _store.write(_refreshKey, refreshToken);
  }

  Future<void> clear() async {
    await _store.delete(_accessKey);
    await _store.delete(_refreshKey);
  }

  Future<bool> hasSession() async => (await readAccessToken()) != null;
}
