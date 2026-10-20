/// Dio-based API client for the VeilVPN Worker API.
///
/// Matches `packages/shared/src/openapi.yaml` exactly:
/// * attaches the short-lived access JWT as `Authorization: Bearer <token>`
/// * transparently rotates tokens: on 401 it calls `POST /v1/auth/refresh`
///   once (guarded against concurrent refreshes) and retries the request
/// * sends `X-Request-Id` on every request and logs method/path/requestId/
///   status/duration for support correlation
/// * maps the `{error:{code,message}, requestId}` envelope to typed
///   [ApiException]s
library;

import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import 'config.dart';
import 'models.dart';
import 'secure_store.dart';

/// Typed API error. `code` is the machine-readable code from the server
/// (e.g. `rate_limited`, `validation_error`); `requestId` is echoed on every
/// error response for support correlation.
class ApiException implements Exception {
  final String code;
  final String message;
  final String? requestId;
  final int? statusCode;

  const ApiException({
    required this.code,
    required this.message,
    this.requestId,
    this.statusCode,
  });

  @override
  String toString() => 'ApiException($code): $message';

  /// Parse the standard `{error:{code,message}, requestId}` envelope.
  factory ApiException.fromResponse(Response response) {
    final data = response.data;
    String code = 'unknown_error';
    String message = 'Request failed (HTTP ${response.statusCode}).';
    String? requestId;
    if (data is Map<String, dynamic>) {
      final err = data['error'];
      if (err is Map<String, dynamic>) {
        if (err['code'] is String) code = err['code'] as String;
        if (err['message'] is String) message = err['message'] as String;
      }
      if (data['requestId'] is String) requestId = data['requestId'] as String;
    }
    requestId ??= response.headers.value('x-request-id');

    final status = response.statusCode;
    if (status == 401 || code == 'unauthorized') {
      return AuthException(
          code: code, message: message, requestId: requestId, statusCode: status);
    }
    if (status == 402) {
      return NoEntitlementException(
          code: code, message: message, requestId: requestId, statusCode: status);
    }
    if (status == 403 && code == 'device_limit_reached') {
      return DeviceLimitException(
          code: code, message: message, requestId: requestId, statusCode: status);
    }
    if (status == 404) {
      return NotFoundException(
          code: code, message: message, requestId: requestId, statusCode: status);
    }
    if (status == 409) {
      return ConflictException(
          code: code, message: message, requestId: requestId, statusCode: status);
    }
    if (status == 429) {
      final retryAfter =
          int.tryParse(response.headers.value('retry-after') ?? '');
      return RateLimitedException(
        code: code,
        message: message,
        requestId: requestId,
        statusCode: status,
        retryAfterSeconds: retryAfter,
      );
    }
    return ApiException(
        code: code, message: message, requestId: requestId, statusCode: status);
  }
}

class AuthException extends ApiException {
  const AuthException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode});
}

/// Refresh token invalid/revoked/reused — the user must log in again.
class SessionExpiredException extends AuthException {
  const SessionExpiredException({super.requestId})
      : super(code: 'session_expired', message: 'Session expired. Please log in again.');
}

class NoEntitlementException extends ApiException {
  const NoEntitlementException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode});
}

class DeviceLimitException extends ApiException {
  const DeviceLimitException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode});
}

class NotFoundException extends ApiException {
  const NotFoundException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode});
}

class ConflictException extends ApiException {
  const ConflictException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode});
}

class RateLimitedException extends ApiException {
  final int? retryAfterSeconds;
  const RateLimitedException(
      {required super.code,
      required super.message,
      super.requestId,
      super.statusCode,
      this.retryAfterSeconds});
}

/// Abstract client so tests can inject fakes without Dio.
abstract class VeilApiClient {
  Future<({String userId, bool emailVerificationRequired})> register(
      String email, String password);
  Future<AuthTokens> login(String email, String password);
  Future<AuthTokens> loginWithGoogle(String idToken);
  Future<AuthTokens> refresh(String refreshToken);
  Future<void> logout(String refreshToken);
  Future<bool> verifyEmail(String token);
  Future<void> forgotPassword(String email);
  Future<void> resetPassword(String token, String newPassword);

  Future<UserProfile> getMe();
  Future<UserProfile> updateMe({String? email});

  Future<List<Device>> listDevices();
  Future<Device> registerDevice({
    required String name,
    required String platform,
    required String wgPublicKey,
  });
  Future<void> deleteDevice(String id);

  Future<List<VpnNode>> listNodes();
  Future<WireGuardPeerConfig> connect({
    required String deviceId,
    String? nodeId,
  });
  Future<void> disconnectPeer(String deviceId);

  Future<SubscriptionView> getSubscription();
  Future<Uri> createCheckout({required String planId, required String provider});
  Future<Uri> createPortal();

  Future<List<Announcement>> listAnnouncements();
  Future<Map<String, dynamic>> exportData();
  Future<void> deleteAccount();
}

/// Dio implementation of [VeilApiClient].
class DioVeilApiClient implements VeilApiClient {
  final SecureStore _store;
  final Dio _dio;
  final Dio _refreshDio;

  /// Guards concurrent 401s so only one refresh request is in flight.
  Future<AuthTokens>? _refreshInFlight;

  DioVeilApiClient({
    required SecureStore store,
    Dio? dio,
    String? baseUrl,
  })  : _store = store,
        _dio = dio ??
            Dio(BaseOptions(
              baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
              connectTimeout: AppConfig.connectTimeout,
              receiveTimeout: AppConfig.receiveTimeout,
              contentType: Headers.jsonContentType,
              responseType: ResponseType.json,
            )),
        _refreshDio = Dio(BaseOptions(
          baseUrl: baseUrl ?? AppConfig.apiBaseUrl,
          connectTimeout: AppConfig.connectTimeout,
          receiveTimeout: AppConfig.receiveTimeout,
          contentType: Headers.jsonContentType,
          responseType: ResponseType.json,
        )) {
    _dio.interceptors.add(_authInterceptor());
    if (kDebugMode) {
      _dio.interceptors.add(LogInterceptor(
        requestHeader: false,
        requestBody: true,
        responseBody: false,
        error: true,
      ));
    }
  }

  /// Endpoints that never carry an Authorization header.
  static const _publicPaths = <String>{
    '/v1/auth/register',
    '/v1/auth/login',
    '/v1/auth/google',
    '/v1/auth/refresh',
    '/v1/auth/verify-email',
    '/v1/auth/forgot-password',
    '/v1/auth/reset-password',
    '/v1/nodes',
    '/v1/announcements',
  };

  bool _isPublic(String path) =>
      _publicPaths.any((p) => path == p || path.startsWith('$p?'));

  InterceptorsWrapper _authInterceptor() => InterceptorsWrapper(
        onRequest: (options, handler) async {
          // Correlation: every request gets a request id (the server echoes
          // its own X-Request-Id back; ours lets us match client logs).
          options.headers['X-Request-Id'] = const Uuid().v4();
          if (!_isPublic(options.path)) {
            final token = await _store.readAccessToken();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          options.extra['veil_started_at'] =
              DateTime.now().millisecondsSinceEpoch;
          handler.next(options);
        },
        onResponse: (response, handler) {
          _logResponse(response);
          handler.next(response);
        },
        onError: (DioException err, handler) async {
          final response = err.response;
          if (response != null) _logResponse(response);

          final options = err.requestOptions;
          final status = response?.statusCode;
          final alreadyRetried = options.extra['veil_retried'] == true;
          final isRefreshCall = options.path.endsWith('/v1/auth/refresh');

          // Transparent token rotation: one refresh in flight, then retry.
          if (status == 401 &&
              !alreadyRetried &&
              !isRefreshCall &&
              !_isPublic(options.path)) {
            try {
              final tokens = await _performRefresh();
              options.headers['Authorization'] =
                  'Bearer ${tokens.accessToken}';
              options.headers['X-Request-Id'] = const Uuid().v4();
              options.extra['veil_retried'] = true;
              final retry = await _dio.fetch(options);
              handler.resolve(retry);
              return;
            } on SessionExpiredException catch (e) {
              handler.reject(DioException(
                requestOptions: options,
                response: response,
                type: DioExceptionType.badResponse,
                error: e,
              ));
              return;
            } catch (_) {
              // Fall through to the original 401 below.
            }
          }

          if (err.type == DioExceptionType.connectionTimeout ||
              err.type == DioExceptionType.receiveTimeout ||
              err.type == DioExceptionType.sendTimeout) {
            handler.reject(DioException(
              requestOptions: options,
              type: err.type,
              error: const ApiException(
                code: 'network_timeout',
                message: 'Connection timed out. Check your network and try again.',
              ),
            ));
            return;
          }
          if (err.type == DioExceptionType.connectionError) {
            handler.reject(DioException(
              requestOptions: options,
              type: err.type,
              error: const ApiException(
                code: 'network_error',
                message:
                    'Could not reach the VeilVPN API. Check your connection.',
              ),
            ));
            return;
          }
          if (response != null) {
            handler.reject(DioException(
              requestOptions: options,
              response: response,
              type: DioExceptionType.badResponse,
              error: ApiException.fromResponse(response),
            ));
            return;
          }
          handler.next(err);
        },
      );

  void _logResponse(Response response) {
    final started = response.requestOptions.extra['veil_started_at'];
    final ms = started is int
        ? DateTime.now().millisecondsSinceEpoch - started
        : -1;
    final reqId = response.requestOptions.headers['X-Request-Id'];
    debugPrint(
        '[veil-api] ${response.requestOptions.method} '
        '${response.requestOptions.path} -> ${response.statusCode} '
        '(${ms}ms) req=$reqId');
  }

  /// Rotates the refresh token exactly once per concurrent burst.
  /// Throws [SessionExpiredException] when the refresh token is
  /// invalid/revoked/reused (family reuse revokes the whole family server-side).
  Future<AuthTokens> _performRefresh() {
    final inFlight = _refreshInFlight;
    if (inFlight != null) return inFlight;
    final future = _doRefresh();
    _refreshInFlight = future;
    future.whenComplete(() => _refreshInFlight = null);
    return future;
  }

  Future<AuthTokens> _doRefresh() async {
    final refreshToken = await _store.readRefreshToken();
    if (refreshToken == null || refreshToken.isEmpty) {
      await _store.clearTokens();
      throw const SessionExpiredException();
    }
    try {
      final res = await _refreshDio.post<Map<String, dynamic>>(
        '/v1/auth/refresh',
        data: {'refreshToken': refreshToken},
        options: Options(headers: {'X-Request-Id': const Uuid().v4()}),
      );
      final tokens =
          AuthTokens.fromJson((res.data ?? const {}) as Map<String, dynamic>);
      await _store.writeTokens(
          accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    } on DioException catch (e) {
      final status = e.response?.statusCode;
      if (status == 401 || status == 400) {
        // Invalid, revoked, or reused refresh token — session is gone.
        await _store.clearTokens();
        final reqId = e.response?.headers.value('x-request-id');
        throw SessionExpiredException(requestId: reqId);
      }
      // Network/timeout during refresh: keep the stored tokens and surface
      // a retryable error instead of logging the user out.
      throw const ApiException(
        code: 'network_error',
        message:
            'Could not refresh the session. Check your connection and try again.',
      );
    }
  }

  Never _throwApi(DioException e) {
    final err = e.error;
    if (err is ApiException) throw err;
    final response = e.response;
    if (response != null) throw ApiException.fromResponse(response);
    throw ApiException(code: 'network_error', message: e.message ?? 'Network error');
  }

  Future<T> _call<T>(Future<T> Function() fn) async {
    try {
      return await fn();
    } on DioException catch (e) {
      _throwApi(e);
    }
  }

  Map<String, dynamic> _json(Response r) =>
      (r.data as Map<String, dynamic>?) ?? const {};

  /* ---------------- auth ---------------- */

  @override
  Future<({String userId, bool emailVerificationRequired})> register(
      String email, String password) {
    return _call(() async {
      final r = await _dio.post('/v1/auth/register',
          data: {'email': email, 'password': password});
      final j = _json(r);
      return (
        userId: j['userId'] as String? ?? '',
        emailVerificationRequired: j['emailVerificationRequired'] as bool? ?? true,
      );
    });
  }

  @override
  Future<AuthTokens> login(String email, String password) {
    return _call(() async {
      final r = await _dio.post('/v1/auth/login',
          data: {'email': email, 'password': password});
      final tokens = AuthTokens.fromJson(_json(r));
      await _store.writeTokens(
          accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    });
  }

  @override
  Future<AuthTokens> loginWithGoogle(String idToken) {
    return _call(() async {
      final r = await _dio.post('/v1/auth/google', data: {'idToken': idToken});
      final tokens = AuthTokens.fromJson(_json(r));
      await _store.writeTokens(
          accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    });
  }

  @override
  Future<AuthTokens> refresh(String refreshToken) {
    // Explicit refresh (used at startup); the interceptor path uses _doRefresh.
    return _call(() async {
      final r = await _dio.post('/v1/auth/refresh',
          data: {'refreshToken': refreshToken});
      final tokens = AuthTokens.fromJson(_json(r));
      await _store.writeTokens(
          accessToken: tokens.accessToken, refreshToken: tokens.refreshToken);
      return tokens;
    });
  }

  @override
  Future<void> logout(String refreshToken) {
    return _call(() async {
      try {
        await _dio.post('/v1/auth/logout', data: {'refreshToken': refreshToken});
      } finally {
        await _store.clearAll();
      }
    });
  }

  @override
  Future<bool> verifyEmail(String token) {
    return _call(() async {
      final r =
          await _dio.post('/v1/auth/verify-email', data: {'token': token});
      return _json(r)['verified'] as bool? ?? false;
    });
  }

  @override
  Future<void> forgotPassword(String email) {
    return _call(() async {
      await _dio.post('/v1/auth/forgot-password', data: {'email': email});
    });
  }

  @override
  Future<void> resetPassword(String token, String newPassword) {
    return _call(() async {
      await _dio.post('/v1/auth/reset-password',
          data: {'token': token, 'newPassword': newPassword});
    });
  }

  /* ---------------- me / devices ---------------- */

  @override
  Future<UserProfile> getMe() => _call(() async {
        final r = await _dio.get('/v1/me');
        return UserProfile.fromJson(_json(r));
      });

  @override
  Future<UserProfile> updateMe({String? email}) => _call(() async {
        final r = await _dio.patch('/v1/me', data: {'email': email});
        return UserProfile.fromJson(_json(r));
      });

  @override
  Future<List<Device>> listDevices() => _call(() async {
        final r = await _dio.get('/v1/devices');
        final list = _json(r)['devices'] as List? ?? const [];
        return list
            .whereType<Map<String, dynamic>>()
            .map(Device.fromJson)
            .toList();
      });

  @override
  Future<Device> registerDevice({
    required String name,
    required String platform,
    required String wgPublicKey,
  }) =>
      _call(() async {
        final r = await _dio.post('/v1/devices', data: {
          'name': name,
          'platform': platform,
          'wgPublicKey': wgPublicKey,
        });
        return Device.fromJson(_json(r));
      });

  @override
  Future<void> deleteDevice(String id) => _call(() async {
        await _dio.delete('/v1/devices/$id');
      });

  /* ---------------- nodes / connect ---------------- */

  @override
  Future<List<VpnNode>> listNodes() => _call(() async {
        final r = await _dio.get('/v1/nodes');
        final list = _json(r)['nodes'] as List? ?? const [];
        return list
            .whereType<Map<String, dynamic>>()
            .map(VpnNode.fromJson)
            .toList();
      });

  @override
  Future<WireGuardPeerConfig> connect({
    required String deviceId,
    String? nodeId,
  }) =>
      _call(() async {
        final r = await _dio.post('/v1/connect', data: {
          'deviceId': deviceId,
          if (nodeId != null) 'nodeId': nodeId,
        });
        return WireGuardPeerConfig.fromJson(_json(r));
      });

  @override
  Future<void> disconnectPeer(String deviceId) => _call(() async {
        // Optional per spec; best-effort peer removal server-side.
        try {
          await _dio.post('/v1/disconnect', data: {'deviceId': deviceId});
        } on DioException {
          // Non-fatal: peers expire automatically server-side.
        }
      });

  /* ---------------- subscription / billing ---------------- */

  @override
  Future<SubscriptionView> getSubscription() => _call(() async {
        final r = await _dio.get('/v1/subscription');
        return SubscriptionView.fromJson(_json(r));
      });

  @override
  Future<Uri> createCheckout(
          {required String planId, required String provider}) =>
      _call(() async {
        final r = await _dio.post('/v1/billing/checkout',
            data: {'planId': planId, 'provider': provider});
        final url = _json(r)['checkoutUrl'] as String?;
        if (url == null || url.isEmpty) {
          throw const ApiException(
              code: 'bad_response', message: 'No checkout URL returned.');
        }
        return Uri.parse(url);
      });

  @override
  Future<Uri> createPortal() => _call(() async {
        final r = await _dio.post('/v1/billing/portal');
        final url = _json(r)['portalUrl'] as String?;
        if (url == null || url.isEmpty) {
          throw const ApiException(
              code: 'no_billing_customer',
              message: 'No billing customer on file.');
        }
        return Uri.parse(url);
      });

  /* ---------------- misc ---------------- */

  @override
  Future<List<Announcement>> listAnnouncements() => _call(() async {
        final r = await _dio.get('/v1/announcements');
        final list = _json(r)['announcements'] as List? ?? const [];
        return list
            .whereType<Map<String, dynamic>>()
            .map(Announcement.fromJson)
            .toList();
      });

  @override
  Future<Map<String, dynamic>> exportData() => _call(() async {
        final r = await _dio.get('/v1/gdpr/export');
        return _json(r);
      });

  @override
  Future<void> deleteAccount() => _call(() async {
        try {
          await _dio.delete('/v1/gdpr/account');
        } finally {
          await _store.clearAll();
        }
      });
}
