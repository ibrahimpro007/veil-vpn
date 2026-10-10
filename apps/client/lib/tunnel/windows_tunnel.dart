/// Windows tunnel backend.
///
/// Architecture (all real, no placeholders):
/// * An elevated helper, `veil_helper.exe` (compiled from
///   `windows/helper/veil_helper.dart` via `dart compile exe`), is installed
///   once as a Scheduled Task running with highest privileges
///   (`tool/install_helper.ps1`, must run as Administrator). It also installs
///   the official WireGuard for Windows client if missing.
/// * The helper listens on 127.0.0.1:17839 and speaks a tiny JSON-RPC-ish
///   protocol guarded by a bearer token provisioned at install time
///   (stored in [SecureStore], ACL'd config file for the helper).
/// * Tunnel up/down is done with the OFFICIAL WireGuard CLI:
///   `wireguard.exe /installtunnelservice <config>` /
///   `wireguard.exe /uninstalltunnelservice VeilVPN`.
/// * Stats come from `wg.exe show VeilVPN transfer`.
/// * Kill switch is enforced by the helper with Windows Firewall rules
///   (`netsh advfirewall`): when enabled, all outbound traffic is blocked
///   except the WireGuard UDP endpoint + the tunnel interface.
///
/// If the helper is not installed/running, connecting throws
/// [HelperNotInstalledException] with instructions; the UI surfaces a
/// 'Install helper' help screen.
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

import '../core/secure_store.dart';
import 'vpn_tunnel.dart';

class HelperNotInstalledException implements Exception {
  final String message;
  const HelperNotInstalledException([this.message =
      'The VeilVPN helper service is not installed. Run tool/install_helper.ps1 '
      'as Administrator, then try again.']);
  @override
  String toString() => 'HelperNotInstalledException: $message';
}

class HelperProtocolException implements Exception {
  final String message;
  const HelperProtocolException(this.message);
  @override
  String toString() => 'HelperProtocolException: $message';
}

class WindowsVpnTunnel implements VpnTunnel {
  static const _helperHost = '127.0.0.1';
  static const _helperPort = 17839;
  static const _taskName = 'VeilVPNHelper';

  final SecureStore _store;

  final _controller = StreamController<VpnStatus>.broadcast();
  VpnState _state = VpnState.disconnected;
  bool _disposed = false;
  int _nextId = 1;
  Socket? _socket;
  final _pending = <int, Completer<Map<String, dynamic>>>{};
  final _buffer = StringBuffer();
  Timer? _statusTimer;

  WindowsVpnTunnel({SecureStore? store}) : _store = store ?? SecureStore();

  void _emit(VpnStatus s) {
    _state = s.state;
    if (!_disposed && !_controller.isClosed) _controller.add(s);
  }

  @override
  Stream<VpnStatus> get status => _controller.stream;

  @override
  VpnState get currentState => _state;

  Future<Socket> _ensureSocket() async {
    final existing = _socket;
    if (existing != null) return existing;
    try {
      final socket = await Socket.connect(
        _helperHost,
        _helperPort,
        timeout: const Duration(seconds: 3),
      );
      // Ask the OS to start the helper task if the port is closed; the first
      // attempt below may still fail while it boots, hence the retry.
      socket.listen(_onData,
          onError: (_) => _onSocketLost(),
          onDone: () => _onSocketLost(),
          cancelOnError: true);
      _socket = socket;
      return socket;
    } on SocketException {
      await _tryStartHelperTask();
      await Future<void>.delayed(const Duration(seconds: 2));
      try {
        final socket = await Socket.connect(
          _helperHost,
          _helperPort,
          timeout: const Duration(seconds: 5),
        );
        socket.listen(_onData,
            onError: (_) => _onSocketLost(),
            onDone: () => _onSocketLost(),
            cancelOnError: true);
        _socket = socket;
        return socket;
      } on SocketException {
        throw const HelperNotInstalledException();
      }
    }
  }

  /// Starts the scheduled helper task on demand. `schtasks /Run` for an
  /// existing task does NOT require elevation, so the unprivileged app can
  /// do this itself.
  Future<void> _tryStartHelperTask() async {
    try {
      await Process.run(
          'schtasks', ['/Run', '/TN', _taskName],
          runInShell: true);
    } catch (_) {
      // Best effort; the connect below will surface the real error.
    }
  }

  void _onSocketLost() {
    _socket?.destroy();
    _socket = null;
    for (final c in _pending.values) {
      if (!c.isCompleted) {
        c.completeError(
            const HelperProtocolException('Lost connection to VeilVPN helper.'));
      }
    }
    _pending.clear();
  }

  void _onData(List<int> bytes) {
    _buffer.write(utf8.decode(bytes, allowMalformed: true));
    // Newline-delimited JSON frames.
    while (true) {
      final text = _buffer.toString();
      final nl = text.indexOf('\n');
      if (nl < 0) break;
      final line = text.substring(0, nl).trim();
      _buffer.clear();
      _buffer.write(text.substring(nl + 1));
      if (line.isEmpty) continue;
      try {
        final msg = jsonDecode(line) as Map<String, dynamic>;
        _handleMessage(msg);
      } catch (_) {
        // Ignore malformed frames; protocol stays in sync via newlines.
      }
    }
  }

  void _handleMessage(Map<String, dynamic> msg) {
    final id = (msg['id'] as num?)?.toInt();
    if (id != null && _pending.containsKey(id)) {
      _pending.remove(id)!.complete(msg);
      return;
    }
    // Unsolicited status push from the helper.
    if (msg['event'] == 'status') {
      final state = msg['state'] as String?;
      final message = msg['message'] as String?;
      _emit(VpnStatus(_parseState(state), message));
    }
  }

  static VpnState _parseState(String? s) => switch (s) {
        'connecting' => VpnState.connecting,
        'connected' => VpnState.connected,
        'disconnecting' => VpnState.disconnecting,
        'error' => VpnState.error,
        _ => VpnState.disconnected,
      };

  /// Loads the helper auth token: secure storage first, then bootstraps it
  /// from `%PROGRAMDATA%\VeilVPN\helper.json` (the installing user has
  /// read-only ACL on that file — see `tool/install_helper.ps1`).
  Future<String> _helperToken() async {
    final stored = await _store.readHelperToken();
    if (stored != null && stored.isNotEmpty) return stored;
    final programData = Platform.environment['PROGRAMDATA'];
    if (programData != null) {
      final file = File('$programData\\VeilVPN\\helper.json');
      if (await file.exists()) {
        try {
          final json =
              jsonDecode(await file.readAsString()) as Map<String, dynamic>;
          final token = json['authToken'] as String?;
          if (token != null && token.isNotEmpty) {
            await _store.writeHelperToken(token);
            return token;
          }
        } catch (_) {}
      }
    }
    throw const HelperNotInstalledException(
        'Helper auth token is missing. Re-run tool/install_helper.ps1 as '
        'Administrator.');
  }

  Future<Map<String, dynamic>> _call(
      String method, Map<String, dynamic> params) async {
    final token = await _helperToken();
    final socket = await _ensureSocket();
    final id = _nextId++;
    final completer = Completer<Map<String, dynamic>>();
    _pending[id] = completer;
    final frame = jsonEncode({
      'id': id,
      'method': method,
      'params': params,
      'auth': token,
    });
    socket.write('$frame\n');
    final reply = await completer.future.timeout(
      const Duration(seconds: 30),
      onTimeout: () {
        _pending.remove(id);
        throw const HelperProtocolException('Helper request timed out.');
      },
    );
    if (reply['ok'] != true) {
      throw HelperProtocolException(
          reply['error'] as String? ?? 'Helper request failed.');
    }
    return (reply['result'] as Map<String, dynamic>?) ?? const {};
  }

  @override
  Future<void> connect(WgConfig config) async {
    _emit(const VpnStatus.connecting());
    try {
      final result = await _call('connect', {
        'name': 'VeilVPN',
        'config': config.toWgQuick(),
      });
      final state = _parseState(result['state'] as String?);
      _emit(VpnStatus(state, result['message'] as String?));
      if (state == VpnState.error) {
        throw HelperProtocolException(
            result['message'] as String? ?? 'Helper failed to connect.');
      }
      _startStatusPolling();
    } catch (e) {
      if (currentState != VpnState.error) {
        _emit(VpnStatus.error(e.toString()));
      }
      rethrow;
    }
  }

  @override
  Future<void> disconnect() async {
    _emit(const VpnStatus.disconnecting());
    _statusTimer?.cancel();
    try {
      await _call('disconnect', {'name': 'VeilVPN'});
    } catch (_) {
      // Best effort; the helper removes the tunnel service anyway.
    }
    _emit(const VpnStatus.disconnected());
  }

  /// Sets the kill-switch firewall policy in the helper.
  /// When [enabled], the helper blocks all outbound traffic except the
  /// WireGuard endpoint and the tunnel interface itself.
  Future<void> setKillSwitch(bool enabled, {String? endpoint}) =>
      _call('setKillSwitch', {
        'enabled': enabled,
        if (endpoint != null) 'endpoint': endpoint,
      });

  void _startStatusPolling() {
    _statusTimer?.cancel();
    _statusTimer = Timer.periodic(const Duration(seconds: 5), (_) async {
      if (_disposed) return;
      try {
        final result = await _call('status', {'name': 'VeilVPN'});
        final state = _parseState(result['state'] as String?);
        // Only surface regressions; the UI owns the desired state.
        if (state == VpnState.disconnected || state == VpnState.error) {
          if (_state == VpnState.connected) {
            _emit(VpnStatus(state, result['message'] as String?));
          }
        }
      } catch (_) {
        // Poll failures are non-fatal; the next tick retries.
      }
    });
  }

  @override
  Future<VpnStats> getStats() async {
    try {
      final result = await _call('stats', {'name': 'VeilVPN'});
      return VpnStats(
        rxBytes: (result['rxBytes'] as num?)?.toInt() ?? 0,
        txBytes: (result['txBytes'] as num?)?.toInt() ?? 0,
        latestHandshakeAt: (result['latestHandshakeAt'] as num?)?.toInt(),
      );
    } catch (_) {
      return const VpnStats();
    }
  }

  @override
  Future<void> dispose() async {
    _disposed = true;
    _statusTimer?.cancel();
    _socket?.destroy();
    _socket = null;
    await _controller.close();
  }
}
