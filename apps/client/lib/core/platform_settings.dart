/// OS-level settings applied from the Settings screen.
///
/// * Kill switch —
///   Android: we cannot toggle Always-on/blocking programmatically as a
///   non-device-owner app, so we deep-link to the system VPN settings screen
///   and explain what to enable. `VpnService.Builder.setBlocking(true)` is
///   always used while our tunnel is up (see `VeilVpnService.kt`).
///   Windows: the elevated helper installs firewall rules (see
///   `windows/helper/veil_helper.dart`).
///   macOS: NEOnDemandRules via the `veil_vpn/system` channel
///   (see `VeilVpnPlugin.swift`).
/// * Launch at login —
///   Windows: HKCU `...\Run` registry value (this process already runs as the
///   user — no elevation needed).
///   macOS: user LaunchAgent plist at `~/Library/LaunchAgents`.
///   Android: `BOOT_COMPLETED` receiver is declared but the OS only
///   auto-starts the *service UI state*; we persist the preference and restore
///   it on boot to re-offer connecting (documented in the manifest receiver).
library;

import 'dart:ffi';
import 'dart:io';

import 'package:ffi/ffi.dart';
import 'package:flutter/services.dart';
import 'package:win32/win32.dart';

class PlatformSettings {
  PlatformSettings._();

  static const _system = MethodChannel('veil_vpn/system');

  /* ---------------- kill switch ---------------- */

  /// Applies the kill-switch preference. Returns a human-readable note about
  /// what was actually done, so the UI never over-promises.
  static Future<String> applyKillSwitch(bool enabled) async {
    if (Platform.isAndroid) {
      if (enabled) {
        await _system.invokeMethod('openVpnSettings');
        return 'Opened system VPN settings — enable "Always-on VPN" and '
            '"Block connections without VPN" for VeilVPN.';
      }
      return 'Kill switch off. (System Always-on settings are managed by you '
          'in Android VPN settings.)';
    }
    if (Platform.isWindows) {
      await _system.invokeMethod('setKillSwitch', {'enabled': enabled});
      return enabled
          ? 'Firewall kill switch enabled: all traffic outside the tunnel is blocked.'
          : 'Firewall kill switch disabled.';
    }
    if (Platform.isMacOS) {
      await _system.invokeMethod('setKillSwitch', {'enabled': enabled});
      return enabled
          ? 'On-demand kill-switch rules installed. For full protection also '
              'keep "Connect on demand" enabled in System Settings → VPN.'
          : 'On-demand kill-switch rules removed.';
    }
    return 'Kill switch is not supported on this platform yet.';
  }

  /* ---------------- launch at login ---------------- */

  static Future<String> applyLaunchAtLogin(bool enabled) async {
    if (Platform.isWindows) {
      return _setWindowsRunKey(enabled);
    }
    if (Platform.isMacOS) {
      await _system.invokeMethod('setLaunchAtLogin', {'enabled': enabled});
      return enabled
          ? 'VeilVPN will start at login.'
          : 'VeilVPN will no longer start at login.';
    }
    if (Platform.isAndroid) {
      // Handled by BootReceiver in the manifest; the preference is enough.
      return enabled
          ? 'VeilVPN will offer to reconnect after reboot.'
          : 'Reboot reconnect disabled.';
    }
    return 'Launch at login is not supported on this platform yet.';
  }

  /// Writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run\VeilVPN.
  /// Runs as the current user — no elevation required.
  static String _setWindowsRunKey(bool enabled) {
    const subKey = r'Software\Microsoft\Windows\CurrentVersion\Run';
    final exePath = Platform.resolvedExecutable;
    return using((Arena arena) {
      final subKeyPtr = subKey.toNativeUtf16(allocator: arena);
      final valueNamePtr = 'VeilVPN'.toNativeUtf16(allocator: arena);
      final phkResult = arena<HANDLE>();

      var status = RegCreateKeyEx(
        HKEY_CURRENT_USER,
        subKeyPtr,
        0,
        nullptr,
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE,
        nullptr,
        phkResult,
        nullptr,
      );
      if (status != ERROR_SUCCESS) {
        return 'Could not update startup setting (registry error $status).';
      }
      final hKey = phkResult.value;
      try {
        if (enabled) {
          final value = '"$exePath" --minimized';
          final dataPtr = value.toNativeUtf16(allocator: arena);
          status = RegSetValueEx(
            hKey,
            valueNamePtr,
            0,
            REG_SZ,
            dataPtr.cast<BYTE>(),
            (value.length + 1) * 2,
          );
        } else {
          status = RegDeleteValue(hKey, valueNamePtr);
          if (status == ERROR_FILE_NOT_FOUND) status = ERROR_SUCCESS;
        }
        if (status != ERROR_SUCCESS) {
          return 'Could not update startup setting (registry error $status).';
        }
      } finally {
        RegCloseKey(hKey);
      }
      return enabled
          ? 'VeilVPN will start at login.'
          : 'VeilVPN will no longer start at login.';
    });
  }
}
