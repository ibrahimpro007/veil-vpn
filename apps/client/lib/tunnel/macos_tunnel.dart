/// macOS tunnel backend: MethodChannel `veil_vpn/tunnel` -> [VeilVpnPlugin]
/// (Swift), which drives `NEVPNManager` + a NetworkExtension
/// `PacketTunnelProvider` built on WireGuardKit.
///
/// Status is pushed from Swift over EventChannel `veil_vpn/tunnel_status`.
/// A second MethodChannel `veil_vpn/system` handles launch-at-login
/// (launchd plist) and kill-switch on-demand rules.
library;

import 'dart:async';

import 'package:flutter/services.dart';

import 'vpn_tunnel.dart';

class MacosVpnTunnel implements VpnTunnel {
  static const _methods = MethodChannel('veil_vpn/tunnel');
  static const _statusEvents = EventChannel('veil_vpn/tunnel_status');
  static const _system = MethodChannel('veil_vpn/system');

  final _controller = StreamController<VpnStatus>.broadcast();
  VpnState _state = VpnState.disconnected;
  StreamSubscription? _sub;
  bool _disposed = false;

  MacosVpnTunnel() {
    _sub = _statusEvents.receiveBroadcastStream().listen(
      (event) {
        if (event is Map) {
          final state = _parseState(event['state'] as String?);
          final message = event['message'] as String?;
          _emit(VpnStatus(state, message));
        }
      },
      onError: (Object e) => _emit(VpnStatus.error(e.toString())),
    );
  }

  static VpnState _parseState(String? s) => switch (s) {
        'connecting' => VpnState.connecting,
        'connected' => VpnState.connected,
        'disconnecting' => VpnState.disconnecting,
        'error' => VpnState.error,
        _ => VpnState.disconnected,
      };

  void _emit(VpnStatus s) {
    _state = s.state;
    if (!_disposed && !_controller.isClosed) _controller.add(s);
  }

  /// Enables/disables the kill switch via NEOnDemandRule configuration.
  /// When enabled, an on-demand 'disconnect' rule tears the tunnel down if
  /// the VPN drops unexpectedly... note: true always-on blocking on macOS
  /// requires the user to also enable 'Connect on demand' in System Settings;
  /// we configure the rules and surface that honestly in Settings.
  Future<void> setKillSwitch(bool enabled) =>
      _system.invokeMethod('setKillSwitch', {'enabled': enabled});

  /// Writes/removes the user launchd agent for launch-at-login.
  Future<void> setLaunchAtLogin(bool enabled) =>
      _system.invokeMethod('setLaunchAtLogin', {'enabled': enabled});

  @override
  Stream<VpnStatus> get status => _controller.stream;

  @override
  VpnState get currentState => _state;

  @override
  Future<void> connect(WgConfig config) async {
    _emit(const VpnStatus.connecting());
    try {
      await _methods.invokeMethod('startTunnel', {
        'config': config.toWgQuick(),
        'name': 'VeilVPN',
      });
      // Swift pushes the authoritative status via the EventChannel once the
      // NEVPNConnection reports connected.
    } on PlatformException catch (e) {
      _emit(VpnStatus.error(_friendlyError(e)));
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    _emit(const VpnStatus.disconnecting());
    try {
      await _methods.invokeMethod('stopTunnel');
    } on PlatformException catch (e) {
      _emit(VpnStatus.error(_friendlyError(e)));
      rethrow;
    }
  }

  @override
  Future<VpnStats> getStats() async {
    try {
      final result =
          await _methods.invokeMapMethod<String, dynamic>('getStats');
      final map = result ?? const <String, dynamic>{};
      return VpnStats(
        rxBytes: (map['rxBytes'] as num?)?.toInt() ?? 0,
        txBytes: (map['txBytes'] as num?)?.toInt() ?? 0,
        latestHandshakeAt: (map['latestHandshakeAt'] as num?)?.toInt(),
      );
    } on PlatformException {
      return const VpnStats();
    }
  }

  static String _friendlyError(PlatformException e) {
    switch (e.code) {
      case 'permission_denied':
        return 'VPN permission was denied. Enable VeilVPN in System Settings → VPN.';
      case 'extension_missing':
        return 'The VeilVPN network extension is not installed correctly. Reinstall the app.';
      default:
        return e.message ?? 'VPN error (${e.code})';
    }
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    await _sub?.cancel();
    await _controller.close();
  }
}
