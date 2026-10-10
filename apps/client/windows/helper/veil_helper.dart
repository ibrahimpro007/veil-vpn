/// VeilVPN Windows helper service.
///
/// Runs ELEVATED (installed as a Scheduled Task with highest privileges by
/// `tool/install_helper.ps1`, which must run as Administrator). The
/// unprivileged Flutter app talks to it over 127.0.0.1:17839 with a bearer
/// token provisioned at install time (`%PROGRAMDATA%\VeilVPN\helper.json`).
///
/// Responsibilities (all need admin, which is why this is a separate exe):
/// * `connect`    — writes the WireGuard config and runs the OFFICIAL
///                   WireGuard CLI: `wireguard.exe /installtunnelservice`.
/// * `disconnect` — `wireguard.exe /uninstalltunnelservice VeilVPN`.
/// * `status`     — `sc query WireGuardTunnel$VeilVPN`.
/// * `stats`      — `wg.exe show VeilVPN transfer` (+ latest-handshakes).
/// * `setKillSwitch` — Windows Firewall rules: allow the WireGuard UDP
///                   endpoint (+ DHCP), block everything else outbound.
///
/// Build: `dart compile exe windows/helper/veil_helper.dart -o veil_helper.exe`
/// (see `windows/build_helper.ps1`; CI builds it, releases ship the exe).
///
/// Protocol: newline-delimited JSON.
///   -> {"id":1,"method":"connect","params":{...},"auth":"<token>"}
///   <- {"id":1,"ok":true,"result":{"state":"connected"}}
///   <- {"id":1,"ok":false,"error":"..."}
/// Unsolicited: {"event":"status","state":"disconnected","message":"..."}
library;

import 'dart:async';
import 'dart:convert';
import 'dart:io';

const _defaultPort = 17839;
const _tunnelName = 'VeilVPN';
const _serviceName = r'WireGuardTunnel$VeilVPN';

void main(List<String> args) async {
  final programData =
      Platform.environment['PROGRAMDATA'] ?? r'C:\ProgramData';
  final veilDir = Directory('$programData\\VeilVPN');
  final configFile = File('${veilDir.path}\\helper.json');

  if (!await configFile.exists()) {
    stderr.writeln(
        '[veil_helper] Missing ${configFile.path}. Run tool/install_helper.ps1 as Administrator.');
    exit(2);
  }
  final config =
      jsonDecode(await configFile.readAsString()) as Map<String, dynamic>;
  final authToken = config['authToken'] as String? ?? '';
  final port = (config['port'] as num?)?.toInt() ?? _defaultPort;
  if (authToken.isEmpty) {
    stderr.writeln('[veil_helper] helper.json has no authToken.');
    exit(2);
  }

  final helper = _Helper(veilDir: veilDir, authToken: authToken);
  final server =
      await ServerSocket.bind(InternetAddress.loopbackIPv4, port);
  stdout.writeln(
      '[veil_helper] Listening on 127.0.0.1:$port (pid=${pid}).');
  helper.startStateWatcher();

  await for (final socket in server) {
    unawaited(helper.handleClient(socket));
  }
}

class _Helper {
  final Directory veilDir;
  final String authToken;

  final _clients = <Socket>{};
  String _lastKnownState = 'disconnected';
  bool _stateFromCommand = false;

  _Helper({required this.veilDir, required this.authToken});

  File get _confFile => File('${veilDir.path}\\veil.conf');

  /* ---------------- client handling ---------------- */

  Future<void> handleClient(Socket socket) async {
    _clients.add(socket);
    final lines = socket
        .cast<List<int>>()
        .transform(utf8.decoder)
        .transform(const LineSplitter());
    try {
      await for (final line in lines) {
        if (line.trim().isEmpty) continue;
        Map<String, dynamic>? msg;
        try {
          msg = jsonDecode(line) as Map<String, dynamic>;
        } catch (_) {
          continue;
        }
        final id = (msg['id'] as num?)?.toInt() ?? 0;
        if (!_constantTimeEquals(
            msg['auth'] as String? ?? '', authToken)) {
          _reply(socket, id, ok: false, error: 'Unauthorized.');
          continue;
        }
        final method = msg['method'] as String? ?? '';
        final params =
            (msg['params'] as Map<String, dynamic>?) ?? const {};
        try {
          final result = await _dispatch(method, params);
          _stateFromCommand = true;
          _reply(socket, id, ok: true, result: result);
        } catch (e) {
          _reply(socket, id, ok: false, error: e.toString());
        }
      }
    } catch (_) {
      // Client went away.
    } finally {
      _clients.remove(socket);
      try {
        await socket.close();
      } catch (_) {}
    }
  }

  void _reply(Socket socket, int id,
      {required bool ok, Map<String, dynamic>? result, String? error}) {
    final msg = {
      'id': id,
      'ok': ok,
      if (ok) 'result': result ?? const {},
      if (!ok) 'error': error ?? 'Unknown error.',
    };
    try {
      socket.write('${jsonEncode(msg)}\n');
    } catch (_) {}
  }

  void _pushEvent(Map<String, dynamic> event) {
    final line = '${jsonEncode(event)}\n';
    for (final c in _clients.toList()) {
      try {
        c.write(line);
      } catch (_) {}
    }
  }

  Future<Map<String, dynamic>> _dispatch(
      String method, Map<String, dynamic> params) async {
    switch (method) {
      case 'connect':
        return _connect(params['config'] as String? ?? '');
      case 'disconnect':
        return _disconnect();
      case 'status':
        return _status();
      case 'stats':
        return _stats();
      case 'setKillSwitch':
        return _setKillSwitch(
          enabled: params['enabled'] as bool? ?? false,
          endpoint: params['endpoint'] as String?,
        );
      default:
        throw 'Unknown method: $method';
    }
  }

  /* ---------------- WireGuard control ---------------- */

  Future<String?> _findExe(String name, List<String> candidates) async {
    for (final c in candidates) {
      if (await File(c).exists()) return c;
    }
    try {
      final r = await Process.run('where', [name], runInShell: true);
      final first = (r.stdout as String).split('\n').first.trim();
      if (first.isNotEmpty && await File(first).exists()) return first;
    } catch (_) {}
    return null;
  }

  Future<String> _wireGuardExe() async {
    final programFiles = Platform.environment['PROGRAMFILES'] ?? r'C:\Program Files';
    final exe = await _findExe('wireguard.exe', [
      '$programFiles\\WireGuard\\wireguard.exe',
    ]);
    if (exe == null) {
      throw 'WireGuard for Windows is not installed. '
          'Run tool/install_helper.ps1 as Administrator.';
    }
    return exe;
  }

  Future<String> _wgExe() async {
    final programFiles = Platform.environment['PROGRAMFILES'] ?? r'C:\Program Files';
    final exe = await _findExe('wg.exe', [
      '$programFiles\\WireGuard\\wg.exe',
    ]);
    if (exe == null) throw 'wg.exe not found (WireGuard for Windows).';
    return exe;
  }

  Future<Map<String, dynamic>> _connect(String configText) async {
    if (configText.isEmpty) throw 'Empty WireGuard config.';
    final wireguard = await _wireGuardExe();

    // The config contains the client's private key: lock the file down.
    await _confFile.writeAsString(configText, flush: true);
    await Process.run('icacls', [
      _confFile.path, '/inheritance:r',
      '/grant:r', 'SYSTEM:(F)', '/grant:r', 'Administrators:(F)',
    ], runInShell: true);

    final install = await Process.run(
        wireguard, ['/installtunnelservice', _confFile.path],
        runInShell: true);
    if (install.exitCode != 0) {
      throw 'wireguard.exe /installtunnelservice failed: ${(install.stderr as String).trim()}';
    }
    // Wait for the tunnel service to report RUNNING.
    for (var i = 0; i < 30; i++) {
      final state = await _serviceState();
      if (state == 'connected') {
        _lastKnownState = state;
        return {'state': state};
      }
      await Future<void>.delayed(const Duration(milliseconds: 500));
    }
    throw 'Tunnel service did not reach RUNNING state.';
  }

  Future<Map<String, dynamic>> _disconnect() async {
    final wireguard = await _wireGuardExe();
    await Process.run(wireguard, ['/uninstalltunnelservice', _tunnelName],
        runInShell: true);
    _lastKnownState = 'disconnected';
    return {'state': 'disconnected'};
  }

  Future<Map<String, dynamic>> _status() async {
    final state = await _serviceState();
    _lastKnownState = state;
    return {'state': state};
  }

  Future<String> _serviceState() async {
    try {
      final r = await Process.run('sc', ['query', _serviceName],
          runInShell: true);
      final out = r.stdout as String;
      final m = RegExp(r'STATE\s*:\s*(\d+)\s+(\w+)').firstMatch(out);
      if (m != null && m.group(1) == '4') return 'connected';
      return 'disconnected';
    } catch (_) {
      return 'disconnected';
    }
  }

  Future<Map<String, dynamic>> _stats() async {
    var rx = 0, tx = 0, handshake = 0;
    try {
      final wg = await _wgExe();
      final t = await Process.run(wg, ['show', _tunnelName, 'transfer'],
          runInShell: true);
      final line = (t.stdout as String).split('\n').firstWhere(
          (l) => l.trim().isNotEmpty,
          orElse: () => '');
      final parts = line.split(RegExp(r'\s+'));
      if (parts.length >= 3) {
        rx = int.tryParse(parts[1]) ?? 0;
        tx = int.tryParse(parts[2]) ?? 0;
      }
      final h = await Process.run(wg, ['show', _tunnelName, 'latest-handshakes'],
          runInShell: true);
      final hline = (h.stdout as String).split('\n').firstWhere(
          (l) => l.trim().isNotEmpty,
          orElse: () => '');
      final hparts = hline.split(RegExp(r'\s+'));
      if (hparts.length >= 2) handshake = int.tryParse(hparts[1]) ?? 0;
    } catch (_) {
      // Tunnels that are down report zeros.
    }
    return {
      'rxBytes': rx,
      'txBytes': tx,
      'latestHandshakeAt': handshake,
    };
  }

  /* ---------------- kill switch ---------------- */

  /// Firewall kill switch. When enabled: allow UDP to the WireGuard endpoint
  /// and DHCP (so the underlying link keeps its address), block ALL other
  /// outbound traffic. Allow rules take precedence over block rules in
  /// Windows Firewall, so the tunnel handshake always gets through while
  /// everything else is dropped — including LAN traffic. Documented in the
  /// Settings screen.
  Future<Map<String, dynamic>> _setKillSwitch(
      {required bool enabled, String? endpoint}) async {
    const allowEndpoint = 'VeilVPN KS Allow Endpoint';
    const allowDhcp = 'VeilVPN KS Allow DHCP';
    const blockAll = 'VeilVPN KS Block All';

    Future<void> deleteRule(String name) async {
      await Process.run('netsh', [
        'advfirewall', 'firewall', 'delete', 'rule', 'name="$name"'
      ], runInShell: true);
    }

    await deleteRule(allowEndpoint);
    await deleteRule(allowDhcp);
    await deleteRule(blockAll);

    if (enabled) {
      String? ip;
      var port = '51820';
      if (endpoint != null && endpoint.contains(':')) {
        final idx = endpoint.lastIndexOf(':');
        final host = endpoint.substring(0, idx);
        port = endpoint.substring(idx + 1);
        ip = await _resolveIp(host);
      }
      if (ip == null) throw 'Could not resolve endpoint for kill switch.';
      var r = await Process.run('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        'name="$allowEndpoint"', 'dir=out', 'action=allow',
        'protocol=UDP', 'remoteip=$ip', 'remoteport=$port',
      ], runInShell: true);
      if (r.exitCode != 0) throw 'Failed to add endpoint allow rule.';
      r = await Process.run('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        'name="$allowDhcp"', 'dir=out', 'action=allow',
        'protocol=UDP', 'remoteport=67',
      ], runInShell: true);
      if (r.exitCode != 0) throw 'Failed to add DHCP allow rule.';
      r = await Process.run('netsh', [
        'advfirewall', 'firewall', 'add', 'rule',
        'name="$blockAll"', 'dir=out', 'action=block',
      ], runInShell: true);
      if (r.exitCode != 0) throw 'Failed to add block-all rule.';
    }
    return {'enabled': enabled};
  }

  Future<String?> _resolveIp(String host) async {
    if (InternetAddress.tryParse(host) != null) return host;
    try {
      final addrs = await InternetAddress.lookup(host);
      // Prefer IPv4 for the firewall rule.
      for (final a in addrs) {
        if (a.type == InternetAddressType.IPv4) return a.address;
      }
      return addrs.firstOrNull?.address;
    } catch (_) {
      return null;
    }
  }

  /* ---------------- state watcher ---------------- */

  /// Polls the tunnel service; if it dies WITHOUT a command from the app
  /// (crash, user stopped it in services.msc), pushes an event so the
  /// app's auto-reconnect can kick in.
  void startStateWatcher() {
    Timer.periodic(const Duration(seconds: 10), (_) async {
      if (_stateFromCommand) {
        _stateFromCommand = false;
        return;
      }
      try {
        final state = await _serviceState();
        if (state != _lastKnownState) {
          _lastKnownState = state;
          _pushEvent({
            'event': 'status',
            'state': state,
            'message': state == 'disconnected'
                ? 'Tunnel stopped unexpectedly.'
                : null,
          });
        }
      } catch (_) {}
    });
  }
}

bool _constantTimeEquals(String a, String b) {
  if (a.length != b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) {
    diff |= a.codeUnitAt(i) ^ b.codeUnitAt(i);
  }
  return diff == 0;
}
