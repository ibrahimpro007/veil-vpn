/// Authentication state machine.
///
/// Stages: checking (restoring session) -> onboarding -> login/register ->
/// verifyEmail (if the server requires it) -> authenticated.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/secure_store.dart';
import 'providers.dart';

enum AuthStage {
  checking,
  onboarding,
  login,
  register,
  verifyEmail,
  forgotPassword,
  resetPassword,
  authenticated,
}

class AuthState {
  final AuthStage stage;
  final UserProfile? user;
  final bool busy;
  final String? error;
  final String? pendingEmail;

  const AuthState({
    required this.stage,
    this.user,
    this.busy = false,
    this.error,
    this.pendingEmail,
  });

  AuthState copyWith({
    AuthStage? stage,
    UserProfile? user,
    bool? busy,
    String? error,
    String? pendingEmail,
  }) =>
      AuthState(
        stage: stage ?? this.stage,
        user: user ?? this.user,
        busy: busy ?? this.busy,
        error: error,
        pendingEmail: pendingEmail ?? this.pendingEmail,
      );
}

final authProvider =
    StateNotifierProvider<AuthNotifier, AuthState>((ref) {
  return AuthNotifier(
    api: ref.watch(veilApiClientProvider),
    store: ref.watch(secureStoreProvider),
  );
});

class AuthNotifier extends StateNotifier<AuthState> {
  final VeilApiClient _api;
  final SecureStore _store;

  AuthNotifier({required VeilApiClient api, required SecureStore store})
      : _api = api,
        _store = store,
        super(const AuthState(stage: AuthStage.checking)) {
    restoreSession();
  }

  void _setError(Object e) {
    final message = e is ApiException ? e.message : e.toString();
    if (e is SessionExpiredException) {
      // Refresh token is dead — back to login with the reason shown.
      state = AuthState(stage: AuthStage.login, error: message);
    } else {
      state = state.copyWith(busy: false, error: message);
    }
  }

  void goTo(AuthStage stage) =>
      state = state.copyWith(stage: stage, error: null);

  void clearError() => state = state.copyWith(error: null);

  /// Startup: if tokens exist, try a refresh + profile fetch; otherwise show
  /// onboarding (first run) or login.
  Future<void> restoreSession() async {
    state = state.copyWith(stage: AuthStage.checking, error: null);
    try {
      final hasSession = await _store.hasSession();
      final seenOnboarding =
          await _store.readAccessToken() != null || hasSession;
      if (!hasSession) {
        state = state.copyWith(
            stage: seenOnboarding ? AuthStage.login : AuthStage.onboarding);
        return;
      }
      final refreshToken = await _store.readRefreshToken();
      if (refreshToken != null) {
        try {
          await _api.refresh(refreshToken);
        } catch (_) {
          // Refresh failed (expired/revoked) — fall through to login.
          await _store.clearTokens();
          state = state.copyWith(stage: AuthStage.login);
          return;
        }
      }
      final user = await _api.getMe();
      state = state.copyWith(
        stage: user.emailVerified ? AuthStage.authenticated : AuthStage.verifyEmail,
        user: user,
        pendingEmail: user.email,
      );
    } catch (e) {
      state = state.copyWith(stage: AuthStage.login, error: null);
    }
  }

  Future<void> login(String email, String password) async {
    state = state.copyWith(busy: true, error: null);
    try {
      await _api.login(email, password);
      final user = await _api.getMe();
      state = state.copyWith(
        busy: false,
        user: user,
        pendingEmail: user.email,
        stage: user.emailVerified
            ? AuthStage.authenticated
            : AuthStage.verifyEmail,
      );
    } catch (e) {
      _setError(e);
    }
  }

  Future<void> register(String email, String password) async {
    state = state.copyWith(busy: true, error: null);
    try {
      final result = await _api.register(email, password);
      if (result.emailVerificationRequired) {
        state = state.copyWith(
          busy: false,
          stage: AuthStage.verifyEmail,
          pendingEmail: email,
        );
      } else {
        await login(email, password);
      }
    } catch (e) {
      _setError(e);
    }
  }

  /// Re-checks `GET /v1/me` after the user clicks the verification link.
  Future<void> checkEmailVerified() async {
    state = state.copyWith(busy: true, error: null);
    try {
      final user = await _api.getMe();
      state = state.copyWith(
        busy: false,
        user: user,
        stage: user.emailVerified
            ? AuthStage.authenticated
            : AuthStage.verifyEmail,
        error: user.emailVerified
            ? null
            : 'Email is not verified yet. Check your inbox (and spam folder).',
      );
    } catch (e) {
      _setError(e);
    }
  }

  /// Verifies with a token pasted manually (for users who can't tap the link).
  Future<void> verifyWithToken(String token) async {
    state = state.copyWith(busy: true, error: null);
    try {
      final ok = await _api.verifyEmail(token.trim());
      if (ok) {
        final user = await _api.getMe();
        state = state.copyWith(
          busy: false,
          user: user,
          stage: AuthStage.authenticated,
        );
      } else {
        state = state.copyWith(
            busy: false, error: 'Verification failed. Check the token.');
      }
    } catch (e) {
      _setError(e);
    }
  }

  Future<void> forgotPassword(String email) async {
    state = state.copyWith(busy: true, error: null);
    try {
      await _api.forgotPassword(email);
      state = state.copyWith(busy: false, pendingEmail: email);
    } catch (e) {
      _setError(e);
    }
  }

  Future<void> resetPassword(String token, String newPassword) async {
    state = state.copyWith(busy: true, error: null);
    try {
      await _api.resetPassword(token.trim(), newPassword);
      state = state.copyWith(busy: false, stage: AuthStage.login);
    } catch (e) {
      _setError(e);
    }
  }

  Future<void> logout() async {
    state = state.copyWith(busy: true);
    try {
      final refreshToken = await _store.readRefreshToken();
      if (refreshToken != null && refreshToken.isNotEmpty) {
        await _api.logout(refreshToken);
      } else {
        await _store.clearAll();
      }
    } catch (_) {
      await _store.clearAll();
    }
    state = const AuthState(stage: AuthStage.login);
  }

  /// Called by the API interceptor path when the session is gone; the UI
  /// reacts by routing back to login.
  void sessionExpired() {
    state = const AuthState(
      stage: AuthStage.login,
      error: 'Session expired. Please log in again.',
    );
  }
}
