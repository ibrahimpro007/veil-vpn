/// Secure on-device storage for secrets.
///
/// Platform backing (via `flutter_secure_storage`):
/// * Android — EncryptedSharedPreferences, keys wrapped by the Android Keystore.
/// * iOS / macOS — Keychain Services (`kSecAttrAccessibleAfterFirstUnlock`).
/// * Windows — Windows Credential Manager (DPAPI-protected).
/// * Linux — libsecret (GNOME Keyring / KWallet).
///
/// What lives here: access/refresh JWTs, the device WireGuard private key
/// (generated on-device, NEVER uploaded — the server only sees the public
/// key), the registered device id, and the Windows helper auth token.
/// Non-secret preferences (toggles, selected node) live in
/// SharedPreferences via [SettingsController].
library;

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

class SecureStore {
  static const _kAccessToken = 'veil.access_token';
  static const _kRefreshToken = 'veil.refresh_token';
  static const _kWgPrivateKey = 'veil.wg_private_key';
  static const _kWgPublicKey = 'veil.wg_public_key';
  static const _kDeviceId = 'veil.device_id';
  static const _kHelperToken = 'veil.helper_token';

  final FlutterSecureStorage _storage;

  SecureStore({FlutterSecureStorage? storage})
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(
                accessibility: KeychainAccessibility.first_unlock,
              ),
            );

  Future<void> writeTokens({
    required String accessToken,
    required String refreshToken,
  }) async {
    await _storage.write(key: _kAccessToken, value: accessToken);
    await _storage.write(key: _kRefreshToken, value: refreshToken);
  }

  Future<String?> readAccessToken() => _storage.read(key: _kAccessToken);
  Future<String?> readRefreshToken() => _storage.read(key: _kRefreshToken);

  Future<bool> hasSession() async {
    final refresh = await readRefreshToken();
    return refresh != null && refresh.isNotEmpty;
  }

  Future<void> clearTokens() async {
    await _storage.delete(key: _kAccessToken);
    await _storage.delete(key: _kRefreshToken);
  }

  /// WireGuard private key (base64). Generated on-device; never leaves it.
  Future<void> writeWgPrivateKey(String base64Key) =>
      _storage.write(key: _kWgPrivateKey, value: base64Key);
  Future<String?> readWgPrivateKey() => _storage.read(key: _kWgPrivateKey);
  Future<void> writeWgPublicKey(String base64Key) =>
      _storage.write(key: _kWgPublicKey, value: base64Key);
  Future<String?> readWgPublicKey() => _storage.read(key: _kWgPublicKey);

  Future<void> writeDeviceId(String id) =>
      _storage.write(key: _kDeviceId, value: id);
  Future<String?> readDeviceId() => _storage.read(key: _kDeviceId);

  /// Auth token for the elevated Windows helper service (loopback API).
  /// Provisioned by `tool/install_helper.ps1` at install time.
  Future<void> writeHelperToken(String token) =>
      _storage.write(key: _kHelperToken, value: token);
  Future<String?> readHelperToken() => _storage.read(key: _kHelperToken);

  /// Wipes everything: used on logout and on GDPR account deletion.
  Future<void> clearAll() => _storage.deleteAll();
}
