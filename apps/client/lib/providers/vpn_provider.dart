/// VPN connection state machine.
///
/// Connect flow:
/// 1. `GET /v1/subscription` — check `entitlement.canConnect` (402 otherwise).
/// 2. Ensure device: read stored device id, else generate an X25519 keypair
///    ON DEVICE and `POST /v1/devices` (server sees only the public key).
/// 3. `POST /v1/connect {deviceId, nodeId?}` — WireGuard peer config.
/// 4. Build [WgConfig] (private key from secure storage + peer config;
///    DNS always the node resolver; AllowedIPs always include `::/0`).
/// 5. `tunnel.connect(config)`.
///
/// Auto-reconnect: the notifier subscribes to `tunnel.status`. An unexpected
/// drop (tunnel reports disconnected/error while [VpnUiState.wantConnected]
/// is true and the auto-reconnect setting is on) triggers a fresh
/// `POST /v1/connect` + `tunnel.connect` with exponential backoff
/// (2s, 5s, 15s, 30s, 60s, then 120s capped). A user-initiated disconnect
/// cancels everything.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import '../core/platform_info.dart';
import '../core/secure_store.dart';
import '../core/wg_keys.dart';
import '../tunnel/android_tunnel.dart';
import '../tunnel/vpn_tunnel.dart';
import '../tunnel/windows_tunnel.dart';
import 'auth_provider.dart';
import 'providers.dart';
import 'settings_provider.dart';

enum ConnectionPhase {
  disconnected,
  connecting,
  connected,
  disconnecting,
  reconnecting,
  error,
}

class VpnUiState {
  final ConnectionPhase phase;
  final PeerNodeInfo? node;
  final DateTime? connectedSince;
  final VpnStats stats;
  final String? errorMessage;
  final int reconnectAttempt;
  final bool wantConnected;

  const VpnUiState({
    required this.phase,
    this.node,
    this.connectedSince,
    this.stats = const VpnStats(),
    this.errorMessage,
    this.reconnectAttempt = 0,
    this.wantConnected = false,
  });

  bool get isConnected => phase == ConnectionPhase.connected;
  bool get isBusy => phase == ConnectionPhase.connecting ||
      phase == ConnectionPhase.disconnecting ||
      phase == ConnectionPhase.reconnecting;

  VpnUiState copyWith({
    ConnectionPhase? phase,
    PeerNodeInfo? node,
    DateTime? connectedSince,
    VpnStats? stats,
    String? errorMessage,
    int? reconnectAttempt,
    bool? wantConnected,
  }) =>
      VpnUiState(
        phase: phase ?? this.phase,
        node: node ?? this.node,
        connectedSince: connectedSince ?? this.connectedSince,
        stats: stats ?? this.stats,
        errorMessage: errorMessage,
        reconnectAttempt: reconnectAttempt ?? this.reconnectAttempt,
        wantConnected: wantConnected ?? this.wantConnected,
      );
}

final vpnProvider =
    StateNotifierProvider<VpnNotifier, VpnUiState>((ref) {
  final notifier = VpnNotifier(
    api: ref.watch(veilApiClientProvider),
    store: ref.watch(secureStoreProvider),
    tunnel: ref.watch(vpnTunnelProvider),
    settings: ref.watch(settingsProvider),
    onSessionExpired: () =>
        ref.read(authProvider.notifier).sessionExpired(),
  );
  // Settings are re-read on every action via updateSettings (cheap; avoids
  // stale closures).
  ref.listen<AppSettings>(settingsProvider, (_, next) {
    notifier.updateSettings(next);
  });
  // Leaving the authenticated stage (logout, session expiry, account
  // deletion) must never leave the tunnel running behind the login screen.
  ref.listen<AuthState>(authProvider, (_, next) {
    if (next.stage != AuthStage.authenticated) {
      notifier.disconnect();
    }
  });
  return notifier;
});

/// Visible for tests: backoff schedule for auto-reconnect.
Duration reconnectDelay(int attempt) {
  const schedule = [2, 5, 15, 30, 60, 120];
  final seconds =
      attempt < schedule.length ? schedule[attempt] : schedule.last;
  return Duration(seconds: seconds);
}

class VpnNotifier extends StateNotifier<VpnUiState> {
  final VeilApiClient _api;
  final SecureStore _store;
  final VpnTunnel _tunnel;
  final void Function()? _onSessionExpired;
  AppSettings _settings;

  StreamSubscription<VpnStatus>? _tunnelSub;
  Timer? _reconnectTimer;
  Timer? _statsTimer;
  bool _disposed = false;
  int _connectSerial = 0;

  /// True while a user-initiated connect is still waiting for its first
  /// `connected` event. A tunnel error in this window is a *failed connect*
  /// (surface it) — not an *unexpected drop* (reconnect it).
  bool _awaitingFirstSuccess = false;

  VpnNotifier({
    required VeilApiClient api,
    required SecureStore store,
    required VpnTunnel tunnel,
    required AppSettings settings,
    void Function()? onSessionExpired,
  })  : _api = api,
        _store = store,
        _tunnel = tunnel,
        _settings = settings,
        _onSessionExpired = onSessionExpired,
        super(const VpnUiState(phase: ConnectionPhase.disconnected)) {
    _tunnelSub = _tunnel.status.listen(_onTunnelStatus);
  }

  void updateSettings(AppSettings s) => _settings = s;

  /* ---------------- public actions ---------------- */

  Future<void> connect({String? nodeId}) async {
    final serial = ++_connectSerial;
    _reconnectTimer?.cancel();
    _awaitingFirstSuccess = true;
    state = state.copyWith(
      phase: ConnectionPhase.connecting,
      errorMessage: null,
      reconnectAttempt: 0,
      wantConnected: true,
    );
    try {
      // 1. Entitlement gate.
      final sub = await _api.getSubscription();
      final entitlement = sub.entitlement;
      if (entitlement != null && !entitlement.canConnect) {
        throw const NoEntitlementException(
          code: 'no_entitlement',
          message:
              'No active subscription. Subscribe or renew to connect.',
        );
      }

      // 2. Device registration (idempotent per install).
      final deviceId = await _ensureDevice();

      // 3. Peer config (optionally pinned to a node).
      final peer = await _api.connect(
        deviceId: deviceId,
        nodeId: nodeId ?? _settings.selectedNodeId,
      );
      if (serial != _connectSerial || _disposed) return;

      // 4. Assemble the tunnel config.
      final privateKey = await _store.readWgPrivateKey();
      if (privateKey == null || privateKey.isEmpty) {
        throw const ApiException(
            code: 'missing_key',
            message: 'Device key is missing. Reinstall the app to re-register.');
      }
      final config = WgConfig.fromPeerConfig(
        peer,
        privateKey,
        allowedIpsOverride:
            Platform.isAndroid ? const [] : _settings.allowedIpsOverride,
        excludedApps: Platform.isAndroid ? _settings.excludedApps : const [],
      );

      // 5a. Android: system VPN consent.
      if (_tunnel is AndroidVpnTunnel) {
        final granted = await (_tunnel as AndroidVpnTunnel).ensureVpnConsent();
        if (!granted) {
          throw const ApiException(
            code: 'vpn_consent_denied',
            message: 'VPN permission was denied.',
          );
        }
      }

      // 5b. Bring the tunnel up.
      await _tunnel.connect(config);
      if (serial != _connectSerial || _disposed) return;
      state = state.copyWith(
        phase: ConnectionPhase.connecting, // tunnel confirms via status stream
        node: peer.node,
      );

      // 5c. Windows: engage the firewall kill switch once the tunnel is up.
      if (_tunnel is WindowsVpnTunnel && _settings.killSwitch) {
        try {
          await (_tunnel as WindowsVpnTunnel)
              .setKillSwitch(true, endpoint: peer.endpoint);
        } catch (_) {
          // Non-fatal: the tunnel is up; kill switch is best-effort here.
        }
      }
    } on SessionExpiredException {
      if (serial != _connectSerial || _disposed) return;
      _awaitingFirstSuccess = false;
      _onSessionExpired?.call();
    } on ApiException catch (e) {
      if (serial != _connectSerial || _disposed) return;
      _fail(e.message, wantConnected: false);
    } catch (e) {
      if (serial != _connectSerial || _disposed) return;
      _fail('Connection failed: $e', wantConnected: false);
    }
  }

  Future<void> disconnect() async {
    _connectSerial++;
    _reconnectTimer?.cancel();
    _statsTimer?.cancel();
    _awaitingFirstSuccess = false;
    state = state.copyWith(
      phase: ConnectionPhase.disconnecting,
      wantConnected: false,
      reconnectAttempt: 0,
      errorMessage: null,
    );
    try {
      // Windows: drop the firewall kill switch on a CLEAN disconnect so the
      // user gets their normal connection back. On an unexpected drop the
      // rules stay in place (that's the point of a kill switch).
      if (_tunnel is WindowsVpnTunnel && _settings.killSwitch) {
        try {
          await (_tunnel as WindowsVpnTunnel).setKillSwitch(false);
        } catch (_) {}
      }
      await _tunnel.disconnect();
      final deviceId = await _store.readDeviceId();
      if (deviceId != null && deviceId.isNotEmpty) {
        await _api.disconnectPeer(deviceId); // best-effort; optional per spec
      }
    } catch (_) {
      // Tunnel teardown is best-effort; the status stream is authoritative.
    }
    if (!_disposed) {
      state = state.copyWith(
        phase: ConnectionPhase.disconnected,
        node: null,
        connectedSince: null,
        stats: const VpnStats(),
      );
    }
  }

  Future<void> toggle({String? nodeId}) async {
    if (state.isConnected || state.isBusy) {
      await disconnect();
    } else {
      await connect(nodeId: nodeId);
    }
  }

  void clearError() {
    if (state.phase == ConnectionPhase.error) {
      state = state.copyWith(
        phase: ConnectionPhase.disconnected,
        errorMessage: null,
        wantConnected: false,
      );
    } else {
      state = state.copyWith(errorMessage: null);
    }
  }

  /* ---------------- internals ---------------- */

  /// Registers this installation as a device if needed. Returns the device id.
  /// The keypair is generated ON DEVICE; only the public key is uploaded.
  Future<String> _ensureDevice() async {
    final existingId = await _store.readDeviceId();
    var privateKey = await _store.readWgPrivateKey();
    if (existingId != null &&
        existingId.isNotEmpty &&
        privateKey != null &&
        privateKey.isNotEmpty) {
      return existingId;
    }
    final keyPair = await generateWgKeyPair();
    privateKey = keyPair.privateKey;
    try {
      final device = await _api.registerDevice(
        name: defaultDeviceName(),
        platform: currentApiPlatform(),
        wgPublicKey: keyPair.publicKey,
      );
      await _store.writeWgPrivateKey(privateKey);
      await _store.writeWgPublicKey(keyPair.publicKey);
      await _store.writeDeviceId(device.id);
      return device.id;
    } on ConflictException {
      // Public key already registered (reinstall with restored storage):
      // adopt the keypair locally and look the device up.
      await _store.writeWgPrivateKey(privateKey);
      await _store.writeWgPublicKey(keyPair.publicKey);
      final devices = await _api.listDevices();
      final match = devices.where((d) => d.wgPublicKey == keyPair.publicKey);
      if (match.isEmpty) rethrow;
      await _store.writeDeviceId(match.first.id);
      return match.first.id;
    }
  }

  void _fail(String message, {required bool wantConnected}) {
    if (_disposed) return;
    state = state.copyWith(
      phase: ConnectionPhase.error,
      errorMessage: message,
      wantConnected: wantConnected,
    );
  }

  void _onTunnelStatus(VpnStatus status) {
    if (_disposed) return;
    switch (status.state) {
      case VpnState.connected:
        _reconnectTimer?.cancel();
        _awaitingFirstSuccess = false;
        state = state.copyWith(
          phase: ConnectionPhase.connected,
          connectedSince: DateTime.now(),
          errorMessage: null,
          reconnectAttempt: 0,
        );
        _startStatsPolling();
      case VpnState.disconnected:
      case VpnState.error:
        _statsTimer?.cancel();
        if (state.wantConnected) {
          if (_awaitingFirstSuccess) {
            // The initial connect failed — surface it, don't loop.
            _awaitingFirstSuccess = false;
            _fail(status.message ?? 'Could not establish the VPN connection.',
                wantConnected: false);
          } else if (state.phase == ConnectionPhase.reconnecting) {
            // A single drop often surfaces as error + disconnected in quick
            // succession — schedule only once.
            break;
          } else if (_settings.autoReconnect) {
            _scheduleReconnect(status.message);
          } else {
            _fail(status.message ?? 'VPN disconnected unexpectedly.',
                wantConnected: false);
          }
        } else if (state.phase == ConnectionPhase.disconnecting ||
            state.phase == ConnectionPhase.disconnected) {
          state = state.copyWith(
            phase: ConnectionPhase.disconnected,
            node: null,
            connectedSince: null,
            stats: const VpnStats(),
          );
        } else {
          _fail(status.message ?? 'VPN error.', wantConnected: false);
        }
      case VpnState.connecting:
        if (state.phase != ConnectionPhase.reconnecting) {
          state = state.copyWith(phase: ConnectionPhase.connecting);
        }
      case VpnState.disconnecting:
        state = state.copyWith(phase: ConnectionPhase.disconnecting);
    }
  }

  void _scheduleReconnect(String? cause) {
    final attempt = state.reconnectAttempt;
    final delay = reconnectDelay(attempt);
    state = state.copyWith(
      phase: ConnectionPhase.reconnecting,
      errorMessage: cause == null
          ? 'Connection lost. Retrying in ${delay.inSeconds}s…'
          : 'Connection lost ($cause). Retrying in ${delay.inSeconds}s…',
      reconnectAttempt: attempt + 1,
    );
    _reconnectTimer?.cancel();
    _reconnectTimer = Timer(delay, () {
      if (_disposed || !state.wantConnected) return;
      // Fresh peer config every attempt: configs expire server-side.
      unawaited(_reconnectAttempt());
    });
  }

  Future<void> _reconnectAttempt() async {
    if (_disposed || !state.wantConnected) return;
    // Re-run the whole connect flow (new peer config), but keep the
    // reconnect phase + attempt counter visible. This is a retry, not the
    // initial connect, so tunnel errors reschedule rather than fail.
    _awaitingFirstSuccess = false;
    final attempt = state.reconnectAttempt;
    final nodeId = _settings.selectedNodeId;
    state = state.copyWith(phase: ConnectionPhase.connecting);
    try {
      final deviceId = await _ensureDevice();
      final peer = await _api.connect(deviceId: deviceId, nodeId: nodeId);
      final privateKey = await _store.readWgPrivateKey();
      if (privateKey == null || privateKey.isEmpty) {
        throw const ApiException(
            code: 'missing_key', message: 'Device key is missing.');
      }
      final config = WgConfig.fromPeerConfig(
        peer,
        privateKey,
        allowedIpsOverride:
            Platform.isAndroid ? const [] : _settings.allowedIpsOverride,
        excludedApps: Platform.isAndroid ? _settings.excludedApps : const [],
      );
      await _tunnel.connect(config);
      state = state.copyWith(node: peer.node, reconnectAttempt: attempt);
    } catch (e) {
      // Back off again; the status stream may also fire.
      if (_disposed || !state.wantConnected) return;
      if (e is SessionExpiredException) {
        _onSessionExpired?.call();
        return;
      }
      _scheduleReconnect(e is ApiException ? e.message : e.toString());
    }
  }

  void _startStatsPolling() {
    _statsTimer?.cancel();
    _statsTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_disposed || !state.isConnected) return;
      try {
        final stats = await _tunnel.getStats();
        if (!_disposed && state.isConnected) {
          state = state.copyWith(stats: stats);
        }
      } catch (_) {}
    });
  }

  @override
  void dispose() {
    _disposed = true;
    _connectSerial++;
    _reconnectTimer?.cancel();
    _statsTimer?.cancel();
    _tunnelSub?.cancel();
    super.dispose();
  }
}

/// Devices of the current user (account screen).
final devicesProvider = FutureProvider<List<Device>>((ref) async {
  final auth = ref.watch(authProvider);
  if (auth.stage != AuthStage.authenticated) return const [];
  return ref.watch(veilApiClientProvider).listDevices();
});

/// Current subscription + entitlement (account screen).
final subscriptionProvider = FutureProvider<SubscriptionView>((ref) async {
  final auth = ref.watch(authProvider);
  if (auth.stage != AuthStage.authenticated) {
    return const SubscriptionView();
  }
  return ref.watch(veilApiClientProvider).getSubscription();
});
