/// Android tunnel backend: MethodChannel `veil_vpn/tunnel` -> [VeilVpnPlugin]
/// (Kotlin), which drives `VpnService` + `com.wireguard.android:tunnel`
/// (GoBackend, userspace — no root).
///
/// Status is pushed from Kotlin over EventChannel `veil_vpn/tunnel_status`.
/// A second MethodChannel `veil_vpn/system` handles OS settings intents
/// (VPN settings screen for the kill-switch/always-on primer).
library;

import 'dart:async';

import 'package:flutter/services.dart';

import 'vpn_tunnel.dart';

class AndroidVpnTunnel implements VpnTunnel {
  static const _methods = MethodChannel('veil_vpn/tunnel');
  static const _statusEvents = EventChannel('veil_vpn/tunnel_status');
  static const _system = MethodChannel('veil_vpn/system');

  final _controller = StreamController<VpnStatus>.broadcast();
  VpnState _state = VpnState.disconnected;
  StreamSubscription? _sub;
  bool _disposed = false;
  Completer<bool>? _consentCompleter;

  AndroidVpnTunnel() {
    _methods.setMethodCallHandler((call) async {
      // Called by VeilVpnPlugin after the system VPN consent activity
      // finishes: args = {'granted': bool}.
      if (call.method == 'onVpnConsentResult') {
        final granted =
            (call.arguments as Map?)?['granted'] as bool? ?? false;
        _consentCompleter?.complete(granted);
        _consentCompleter = null;
      }
    });
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

  /// Ensures the user granted the system VPN permission.
  ///
  /// The Kotlin plugin calls `VpnService.prepare()`: when it returns an
  /// intent, the plugin launches the system consent activity and reports the
  /// result back via `onVpnConsentResult`. Returns true when we may proceed.
  Future<bool> ensureVpnConsent() async {
    final needsConsent = await _methods.invokeMethod<bool>('prepare');
    if (needsConsent != true) return true;
    _consentCompleter = Completer<bool>();
    try {
      return await _consentCompleter!.future
          .timeout(const Duration(minutes: 2), onTimeout: () => false);
    } finally {
      _consentCompleter = null;
    }
  }

  /// Opens the system VPN settings screen so the user can enable
  /// Always-on VPN + 'Block connections without VPN' (the kill switch).
  /// Non-device-owner apps cannot toggle these programmatically; the OS
  /// settings screen is the only path, so we deep-link to it.
  Future<void> openVpnSettings() =>
      _system.invokeMethod('openVpnSettings');

  @override
  Stream<VpnStatus> get status => _controller.stream;

  @override
  VpnState get currentState => _state;

  @override
  Future<void> connect(WgConfig config) async {
    _emit(const VpnStatus.connecting());
    try {
      await _methods.invokeMethod('connect', {
        'config': config.toWgQuick(),
        'excludedApps': config.excludedApps,
      });
      // Kotlin pushes the authoritative connected/error status via the
      // EventChannel once GoBackend reports the tunnel is up.
    } on PlatformException catch (e) {
      _emit(VpnStatus.error(_friendlyError(e)));
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    _emit(const VpnStatus.disconnecting());
    try {
      await _methods.invokeMethod('disconnect');
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
      case 'vpn_consent_required':
        return 'VPN permission is required. Please allow the VPN connection request.';
      case 'already_connected':
        return 'Already connected.';
      case 'backend_error':
        return 'Could not start the VPN tunnel: ${e.message ?? 'unknown error'}';
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
