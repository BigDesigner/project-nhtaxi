/// Build-time configuration.
///
/// Defaults to production so any artifact built without flags (the CI APK,
/// a release web build) points at the real API. For the local dev loop run
/// the Worker with `wrangler dev` and override:
///
/// ```
/// flutter run -d chrome --web-port=5174 \
///   --dart-define=API_BASE_URL=http://localhost:8787
/// ```
///
/// Port 5174 is not arbitrary — it's the origin allowed by the API's dev
/// CORS list (apps/api/src/app.ts). Flutter Web is browser-hosted, so its
/// requests are CORS-checked even though we authenticate with Bearer tokens.
class AppConfig {
  const AppConfig._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.nhtaxi.com',
  );

  /// The API only returns tokens in the response body for non-web platforms
  /// (see apps/api/src/lib/session.ts). We always identify as a native
  /// platform — including on Flutter Web — so there is exactly one auth code
  /// path across every target: Bearer tokens, never cookies, so the CSRF
  /// middleware never applies to us either.
  static const String authPlatform = 'android';
}
