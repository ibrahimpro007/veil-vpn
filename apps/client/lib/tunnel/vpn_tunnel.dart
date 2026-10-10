/// Platform tunnel abstraction.
///
/// Every OS implements [VpnTunnel] with a native WireGuard backend:
/// * Android — `VpnService` + `com.wireguard.android:tunnel` (GoBackend),
///   driven over MethodChannel `veil_vpn/tunnel`.
/// * Windows — elevated `veil_helper.exe` (scheduled task) driving the
///   official `wireguard.exe /installtunnelservice` CLI, driven over a
///   loopback-TCP JSON protocol.
/// * macOS — NetworkExtension `PacketTunnelProvider` + WireGuardKit,
///   driven over MethodChannel `veil_vpn/tunnel` via `NEVPNManager`.
///
/// DNS-leak / IPv6 policy (all platforms): the peer config's DNS
/// (`10.7.0.1`) is always installed, and AllowedIPs always include
/// `0.0.0.0/0` AND `::/0` so IPv6 traffic is routed into the tunnel and
/// dropped server-side instead of leaking around the VPN. This matches the
/// node-agent behavior (IPv6 is sinkholed, not forwarded).
library;

import 'dart:async';

import '../core/models.dart';

/// Tunnel lifecycle states surfaced to the UI.
enum VpnState {
  disconnected,
  connecting,
  connected,
  disconnecting,
  error,
}

class VpnStatus {
  final VpnState state;
  final String? message;

  const VpnStatus(this.state, [this.message]);

  const VpnStatus.disconnected([String? message])
      : this(VpnState.disconnected, message);
  const VpnStatus.connecting() : this(VpnState.connecting);
  const VpnStatus.connected() : this(VpnState.connected);
  const VpnStatus.disconnecting() : this(VpnState.disconnecting);
  const VpnStatus.error(String message) : this(VpnState.error, message);

  bool get isConnected => state == VpnState.connected;
  bool get isTransitioning =>
      state == VpnState.connecting || state == VpnState.disconnecting;
}

class VpnStats {
  final int rxBytes;
  final int txBytes;

  /// Epoch seconds of the last WireGuard handshake, if the backend exposes it.
  final int? latestHandshakeAt;

  const VpnStats({
    this.rxBytes = 0,
    this.txBytes = 0,
    this.latestHandshakeAt,
  });
}

/// WireGuard tunnel configuration assembled on the client from:
/// * the device private key (secure storage — never uploaded), and
/// * the [WireGuardPeerConfig] returned by `POST /v1/connect`.
class WgConfig {
  final String privateKey; // base64, 44 chars
  final String address; // e.g. '10.7.3.42'
  final String dns; // e.g. '10.7.0.1' — always the node resolver
  final String serverPublicKey; // base64, 44 chars
  final String endpoint; // 'host:port'
  final List<String> allowedIps; // default ['0.0.0.0/0', '::/0']
  final int persistentKeepalive; // seconds

  /// Android split tunneling: package names excluded from the VPN
  /// (`VpnService.Builder.addDisallowedApplication`). Ignored on desktop.
  final List<String> excludedApps;

  /// Desktop split tunneling: custom AllowedIPs override. When set, replaces
  /// [allowedIps]. Documented platform limits apply (Windows/macOS apply it
  /// to the tunnel config; it cannot do per-app routing).
  final List<String>? allowedIpsOverride;

  final int mtu;

  const WgConfig({
    required this.privateKey,
    required this.address,
    required this.dns,
    required this.serverPublicKey,
    required this.endpoint,
    this.allowedIps = const ['0.0.0.0/0', '::/0'],
    this.persistentKeepalive = 25,
    this.excludedApps = const [],
    this.allowedIpsOverride,
    this.mtu = 1280,
  });

  /// Builds a [WgConfig] from the API peer config + the on-device private key.
  factory WgConfig.fromPeerConfig(
    WireGuardPeerConfig peer,
    String privateKey, {
    List<String> allowedIpsOverride = const [],
    List<String> excludedApps = const [],
  }) {
    // Enforce the IPv6 sinkhole policy even if the server ever omits ::/0.
    final ips = <String>{
      ...peer.allowedIps,
      '0.0.0.0/0',
      '::/0',
    }.toList();
    return WgConfig(
      privateKey: privateKey,
      address: peer.address,
      dns: peer.dns,
      serverPublicKey: peer.serverPublicKey,
      endpoint: peer.endpoint,
      allowedIps: ips,
      excludedApps: excludedApps,
      allowedIpsOverride:
          allowedIpsOverride.isEmpty ? null : allowedIpsOverride,
    );
  }

  List<String> get effectiveAllowedIps => allowedIpsOverride ?? allowedIps;

  /// wg-quick / INI-style config understood by every backend
  /// (wireguard-android's `Config.parse`, `wireguard.exe`, WireGuardKit's
  /// `TunnelConfiguration(fromWgQuickConfig:)`).
  String toWgQuick() {
    final sb = StringBuffer()
      ..writeln('[Interface]')
      ..writeln('PrivateKey = $privateKey')
      ..writeln('Address = $address/32')
      ..writeln('DNS = $dns')
      ..writeln('MTU = $mtu')
      ..writeln()
      ..writeln('[Peer]')
      ..writeln('PublicKey = $serverPublicKey')
      ..writeln('AllowedIPs = ${effectiveAllowedIps.join(', ')}')
      ..writeln('Endpoint = $endpoint')
      ..writeln('PersistentKeepalive = $persistentKeepalive');
    return sb.toString();
  }

  Map<String, dynamic> toJson() => {
        'privateKey': privateKey,
        'address': address,
        'dns': dns,
        'serverPublicKey': serverPublicKey,
        'endpoint': endpoint,
        'allowedIps': effectiveAllowedIps,
        'persistentKeepalive': persistentKeepalive,
        'excludedApps': excludedApps,
        'mtu': mtu,
      };
}

abstract class VpnTunnel {
  /// Broadcast stream of tunnel status changes.
  Stream<VpnStatus> get status;

  VpnState get currentState;

  /// Brings the tunnel up with [config]. Emits connecting -> connected
  /// (or -> error) on [status].
  Future<void> connect(WgConfig config);

  /// Tears the tunnel down. Emits disconnecting -> disconnected.
  Future<void> disconnect();

  /// Current byte counters (backends that cannot report them return zeros).
  Future<VpnStats> getStats();

  Future<void> dispose();
}

/// In-memory fake for widget tests and for platforms without a backend yet.
class FakeVpnTunnel implements VpnTunnel {
  final _controller = StreamController<VpnStatus>.broadcast();
  VpnState _state = VpnState.disconnected;
  VpnStats _stats = const VpnStats();
  WgConfig? lastConfig;
  Duration connectDelay;

  FakeVpnTunnel({this.connectDelay = Duration.zero});

  @override
  Stream<VpnStatus> get status => _controller.stream;

  @override
  VpnState get currentState => _state;

  void _emit(VpnStatus s) {
    _state = s.state;
    if (!_controller.isClosed) _controller.add(s);
  }

  @override
  Future<void> connect(WgConfig config) async {
    lastConfig = config;
    _emit(const VpnStatus.connecting());
    await Future.delayed(connectDelay);
    _stats = const VpnStats(rxBytes: 1024, txBytes: 512);
    _emit(const VpnStatus.connected());
  }

  @override
  Future<void> disconnect() async {
    _emit(const VpnStatus.disconnecting());
    await Future.delayed(connectDelay);
    _stats = const VpnStats();
    _emit(const VpnStatus.disconnected());
  }

  /// Test helper: simulate the OS killing the tunnel unexpectedly.
  void simulateUnexpectedDrop(String message) {
    _emit(VpnStatus.error(message));
    _emit(VpnStatus.disconnected(message));
  }

  @override
  Future<VpnStats> getStats() async => _stats;

  @override
  Future<void> dispose() async => _controller.close();
}
