/// Google Sign-In: returns a Google ID token for POST /v1/auth/google.
///
/// - Android / iOS: `google_sign_in` (Play Services / ASWebAuthentication),
///   with the WEB client ID as serverClientId so the token audience is the
///   web client — the API accepts it via GOOGLE_OAUTH_CLIENT_IDS.
/// - Windows / macOS (google_sign_in has no desktop implementation):
///   OAuth 2.0 loopback flow (RFC 8252) — system browser + a one-shot
///   HttpServer on 127.0.0.1, code exchanged at Google's token endpoint.
///   Uses the "Desktop app" OAuth client; per Google's installed-app
///   policy its secret is not treated as confidential.
///
/// Client IDs arrive via --dart-define (set from repo vars in release CI):
///   GOOGLE_WEB_CLIENT_ID, GOOGLE_DESKTOP_CLIENT_ID,
///   GOOGLE_DESKTOP_CLIENT_SECRET
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:google_sign_in/google_sign_in.dart';
import 'package:http/http.dart' as http;
import 'package:url_launcher/url_launcher.dart';

const _webClientId = String.fromEnvironment('GOOGLE_WEB_CLIENT_ID');
const _desktopClientId = String.fromEnvironment('GOOGLE_DESKTOP_CLIENT_ID');
const _desktopClientSecret =
    String.fromEnvironment('GOOGLE_DESKTOP_CLIENT_SECRET');

class GoogleSignInCancelled implements Exception {
  const GoogleSignInCancelled();
  @override
  String toString() => 'Sign-in cancelled.';
}

class GoogleSignInUnavailable implements Exception {
  final String message;
  const GoogleSignInUnavailable(this.message);
  @override
  String toString() => message;
}

/// True when at least one Google flow is configured in this build.
bool get googleSignInConfigured =>
    _webClientId.isNotEmpty || _desktopClientId.isNotEmpty;

Future<String> googleIdToken() async {
  if (Platform.isAndroid || Platform.isIOS) return _mobileIdToken();
  if (Platform.isWindows || Platform.isMacOS || Platform.isLinux) {
    return _desktopIdToken();
  }
  throw const GoogleSignInUnavailable(
      'Google sign-in is not available on this platform.');
}

Future<String> _mobileIdToken() async {
  if (_webClientId.isEmpty) {
    throw const GoogleSignInUnavailable(
        'Google sign-in is not configured in this build.');
  }
  final signIn = GoogleSignIn(
    serverClientId: _webClientId,
    scopes: const ['email', 'profile'],
  );
  final account = await signIn.signIn();
  if (account == null) throw const GoogleSignInCancelled();
  final auth = await account.authentication;
  final idToken = auth.idToken;
  if (idToken == null || idToken.isEmpty) {
    throw const GoogleSignInUnavailable(
        'Google did not return an ID token. Try again.');
  }
  return idToken;
}

String _randomState() {
  final r = Random.secure();
  return base64Url.encode(List<int>.generate(24, (_) => r.nextInt(256)));
}

Future<String> _desktopIdToken() async {
  if (_desktopClientId.isEmpty || _desktopClientSecret.isEmpty) {
    throw const GoogleSignInUnavailable(
        'Google sign-in is not configured in this build.');
  }
  final server = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
  final port = server.port;
  final redirectUri = 'http://127.0.0.1:$port';
  final state = _randomState();
  try {
    final authUrl = Uri.https('accounts.google.com', '/o/oauth2/v2/auth', {
      'client_id': _desktopClientId,
      'redirect_uri': redirectUri,
      'response_type': 'code',
      'scope': 'openid email profile',
      'state': state,
      'prompt': 'select_account',
    });
    if (!await launchUrl(authUrl, mode: LaunchMode.externalApplication)) {
      throw const GoogleSignInUnavailable(
          'Could not open the browser for Google sign-in.');
    }
    final request = await server.first.timeout(
      const Duration(minutes: 5),
      onTimeout: () => throw const GoogleSignInUnavailable(
          'Google sign-in timed out. Please try again.'),
    );
    final params = request.uri.queryParameters;
    await _respondAndClose(request);
    if (params['state'] != state) {
      throw const GoogleSignInUnavailable(
          'Google sign-in failed a security check. Please try again.');
    }
    final error = params['error'];
    if (error != null) {
      if (error == 'access_denied') throw const GoogleSignInCancelled();
      throw GoogleSignInUnavailable('Google sign-in failed: $error');
    }
    final code = params['code'];
    if (code == null || code.isEmpty) {
      throw const GoogleSignInUnavailable(
          'Google sign-in returned no code. Please try again.');
    }
    final tokenRes = await http.post(
      Uri.parse('https://oauth2.googleapis.com/token'),
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: {
        'code': code,
        'client_id': _desktopClientId,
        'client_secret': _desktopClientSecret,
        'redirect_uri': redirectUri,
        'grant_type': 'authorization_code',
      },
    );
    if (tokenRes.statusCode != 200) {
      throw const GoogleSignInUnavailable(
          'Google sign-in could not be completed. Please try again.');
    }
    final json = jsonDecode(tokenRes.body) as Map<String, dynamic>;
    final idToken = json['id_token'] as String?;
    if (idToken == null || idToken.isEmpty) {
      throw const GoogleSignInUnavailable(
          'Google did not return an ID token. Try again.');
    }
    return idToken;
  } finally {
    await server.close(force: true);
  }
}

Future<void> _respondAndClose(HttpRequest request) async {
  request.response
    ..statusCode = 200
    ..headers.contentType = ContentType.html
    ..write('<!doctype html><html><body style="font-family:sans-serif;'
        'background:#0b1220;color:#e2e8f0;text-align:center;padding-top:15%">'
        '<h2>VeilVPN</h2><p>You are signed in. You can close this tab '
        'and return to the app.</p></body></html>');
  await request.response.close();
}
