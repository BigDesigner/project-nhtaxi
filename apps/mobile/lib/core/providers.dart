import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../features/auth/auth_controller.dart';
import 'api_client.dart';
import 'token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    ref.watch(tokenStoreProvider),
    // A dead refresh token means the session is gone; re-running the auth
    // controller re-reads storage (now empty) and drops us to logged-out,
    // which the router turns into a redirect to /login.
    onSessionExpired: () => ref.invalidate(authControllerProvider),
  );
});
