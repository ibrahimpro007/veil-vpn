/// Platform helpers. The `platform` strings match the API enum exactly:
/// `windows | android | macos | linux | ios` (see `platformSchema`).
library;

import 'dart:io';

/// API platform identifier for this device (`POST /v1/devices`).
String currentApiPlatform() {
  if (Platform.isAndroid) return 'android';
  if (Platform.isIOS) return 'ios';
  if (Platform.isWindows) return 'windows';
  if (Platform.isMacOS) return 'macos';
  if (Platform.isLinux) return 'linux';
  return 'windows';
}

/// Human-friendly device name for `POST /v1/devices` (max 100 chars).
String defaultDeviceName() {
  final os = Platform.operatingSystem;
  final version = Platform.operatingSystemVersion.split(' ').first;
  final name = 'VeilVPN on $os $version';
  return name.length > 100 ? name.substring(0, 100) : name;
}

bool get isDesktop =>
    Platform.isWindows || Platform.isMacOS || Platform.isLinux;
bool get isMobile => Platform.isAndroid || Platform.isIOS;
