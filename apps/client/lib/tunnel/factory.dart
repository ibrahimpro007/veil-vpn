/// Picks the platform [VpnTunnel] implementation.
library;

import 'dart:io';

import 'android_tunnel.dart';
import 'macos_tunnel.dart';
import 'vpn_tunnel.dart';
import 'windows_tunnel.dart';

/// Returns the real platform tunnel. Throws [UnsupportedError] on platforms
/// without a native backend (Linux desktop and iOS are not shipped yet —
/// the UI surfaces this honestly instead of pretending to connect).
VpnTunnel createPlatformTunnel() {
  if (Platform.isAndroid) return AndroidVpnTunnel();
  if (Platform.isWindows) return WindowsVpnTunnel();
  if (Platform.isMacOS) return MacosVpnTunnel();
  throw UnsupportedError(
    'VeilVPN does not have a tunnel backend for ${Platform.operatingSystem} yet.',
  );
}
