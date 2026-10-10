/// Server list: `GET /v1/nodes` (public) + client-side latency measurement.
///
/// Latency is measured as ICMP round-trip to the node's endpoint host using
/// the OS `ping` binary (`Process.run` — no special permissions needed).
/// This measures host reachability, NOT WireGuard handshake latency (a UDP
/// handshake probe would require speaking the WG protocol pre-tunnel).
/// Nodes are sorted by latency, then by the server's `sortOrder` hint.
/// The API intentionally exposes no load figures — we never invent any.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/models.dart';
import 'providers.dart';

final nodesProvider =
    StateNotifierProvider<NodesNotifier, AsyncValue<List<VpnNode>>>(
  (ref) => NodesNotifier(api: ref.watch(veilApiClientProvider)),
);

class NodesNotifier extends StateNotifier<AsyncValue<List<VpnNode>>> {
  final VeilApiClient _api;
  bool _measuring = false;

  NodesNotifier({required VeilApiClient api})
      : _api = api,
        super(const AsyncValue.loading()) {
    refresh();
  }

  Future<void> refresh() async {
    state = const AsyncValue.loading();
    try {
      final nodes =
          (await _api.listNodes()).where((n) => n.status != NodeStatus.disabled).toList();
      state = AsyncValue.data(nodes);
      unawaited(measureLatency());
    } catch (e, st) {
      state = AsyncValue.error(e, st);
    }
  }

  /// Pings every node host once and re-sorts. Runs after the list loads.
  Future<void> measureLatency() async {
    if (_measuring) return;
    final current = state.valueOrNull;
    if (current == null || current.isEmpty) return;
    _measuring = true;
    try {
      final measured = await Future.wait(
        current.map((n) async {
          final ms = await PingService.measure(n.host);
          return n.copyWith(latencyMs: ms);
        }),
      );
      measured.sort((a, b) {
        final la = a.latencyMs;
        final lb = b.latencyMs;
        if (la == null && lb == null) return a.sortOrder.compareTo(b.sortOrder);
        if (la == null) return 1;
        if (lb == null) return -1;
        final c = la.compareTo(lb);
        return c != 0 ? c : a.sortOrder.compareTo(b.sortOrder);
      });
      // Only publish if the list hasn't been replaced meanwhile.
      if (state.valueOrNull?.length == measured.length) {
        state = AsyncValue.data(measured);
      }
    } finally {
      _measuring = false;
    }
  }
}

/// ICMP ping via the OS `ping` binary. Returns RTT in ms, or null when the
/// host is unreachable / ping is unavailable.
class PingService {
  PingService._();

  static Future<int?> measure(String host,
      {Duration timeout = const Duration(seconds: 4)}) async {
    try {
      final List<String> args;
      if (Platform.isWindows) {
        // -n 1: one echo; -w: timeout per reply in ms.
        args = ['-n', '1', '-w', '${timeout.inMilliseconds}', host];
      } else {
        // -c 1: one packet; -W: per-packet timeout in seconds (macOS: -W ms).
        final wait = Platform.isMacOS
            ? '${timeout.inMilliseconds}'
            : '${timeout.inSeconds.clamp(1, 10)}';
        args = ['-c', '1', '-W', wait, host];
      }
      final result = await Process.run('ping', args).timeout(
        timeout + const Duration(seconds: 2),
        onTimeout: () => ProcessResult(0, 1, '', 'ping timeout'),
      );
      if (result.exitCode != 0) return null;
      return _parseMs(result.stdout as String);
    } catch (_) {
      return null;
    }
  }

  /// Parses `time=12.3 ms` / `time<1ms` / `Average = 12ms` styles.
  static int? _parseMs(String output) {
    final timeEq = RegExp(r'time[=<]\s*(\d+(?:\.\d+)?)\s*ms');
    final m = timeEq.firstMatch(output);
    if (m != null) {
      return double.parse(m.group(1)!).round();
    }
    final avg = RegExp(r'Average\s*=\s*(\d+)\s*ms');
    final m2 = avg.firstMatch(output);
    if (m2 != null) return int.parse(m2.group(1)!);
    return null;
  }
}
