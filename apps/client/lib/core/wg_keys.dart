/// WireGuard X25519 keypair generation, done ON DEVICE.
///
/// Privacy contract (mirrors `packages/shared/src/types.ts`):
/// the private key is generated here and stored in [SecureStore]; only the
/// 44-char base64 public key is ever uploaded (`POST /v1/devices`).
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart';

class WgKeyPair {
  /// 44-char base64 public key — safe to upload to the API.
  final String publicKey;

  /// 44-char base64 private key — stays in secure storage.
  final String privateKey;

  const WgKeyPair({required this.publicKey, required this.privateKey});
}

/// Generates a fresh X25519 keypair using the `cryptography` package
/// (pure-Dart, no native dependency).
Future<WgKeyPair> generateWgKeyPair() async {
  final algorithm = X25519();
  final keyPair = await algorithm.newKeyPair();
  final publicKey = await keyPair.extractPublicKey();
  final privateBytes = await keyPair.extractPrivateKeyBytes();
  return WgKeyPair(
    publicKey: base64Encode(publicKey.bytes),
    privateKey: base64Encode(privateBytes),
  );
}

/// Derives the public key from a stored private key (used to verify the
/// stored keypair is intact before registering the device).
Future<String> publicKeyFromPrivate(String base64PrivateKey) async {
  final algorithm = X25519();
  // For X25519 the 32-byte private key *is* the seed.
  final keyPair = await algorithm.newKeyPairFromSeed(
    base64Decode(base64PrivateKey),
  );
  final publicKey = await keyPair.extractPublicKey();
  return base64Encode((publicKey as SimplePublicKey).bytes);
}

/// WireGuard public keys are 32 bytes => 44 base64 chars (per openapi.yaml
/// `minLength: 44, maxLength: 44`).
bool isValidWgPublicKey(String key) {
  if (key.length != 44) return false;
  try {
    return base64Decode(key).length == 32;
  } catch (_) {
    return false;
  }
}
