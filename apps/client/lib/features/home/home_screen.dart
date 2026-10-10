/// Home: announcements banner, connection status card, one-tap connect.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/models.dart';
import '../../providers/announcements_provider.dart';
import '../../providers/nodes_provider.dart';
import '../../providers/settings_provider.dart';
import '../../providers/update_provider.dart';
import '../../providers/vpn_provider.dart';
import '../../widgets/ui_kit.dart';

class HomeScreen extends ConsumerStatefulWidget {
  const HomeScreen({super.key});

  @override
  ConsumerState<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends ConsumerState<HomeScreen> {
  bool _updateChecked = false;

  @override
  void initState() {
    super.initState();
    // One update check per app launch (direct flavor only).
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_updateChecked) {
        _updateChecked = true;
        ref.read(updateProvider.notifier).check();
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    final vpn = ref.watch(vpnProvider);
    ref.listen<AsyncValue<UpdateInfo?>>(updateProvider, (_, next) {
      final info = next.valueOrNull;
      if (info != null && info.available && mounted) {
        _showUpdateDialog(info);
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('VeilVPN'),
        centerTitle: true,
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          await ref.read(nodesProvider.notifier).refresh();
          ref.invalidate(announcementsProvider);
        },
        child: SingleChildScrollView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(20),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const AnnouncementBanner(),
              if (vpn.errorMessage != null) ...[
                ErrorBanner(
                  message: vpn.errorMessage!,
                  onDismiss: () =>
                      ref.read(vpnProvider.notifier).clearError(),
                ),
                const SizedBox(height: 16),
              ],
              const ConnectionCard(),
              const SizedBox(height: 24),
              const ConnectButton(),
              const SizedBox(height: 16),
              const QuickServerRow(),
            ],
          ),
        ),
      ),
    );
  }

  void _showUpdateDialog(UpdateInfo info) {
    showDialog(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Update available'),
        content: Text(
          'VeilVPN ${info.latestVersion} is available '
          '(you have ${info.currentVersion}).\n\n${info.notes}',
        ),
        actions: [
          TextButton(
            onPressed: () {
              ref.read(updateProvider.notifier).dismiss();
              Navigator.of(context).pop();
            },
            child: const Text('Later'),
          ),
          FilledButton(
            onPressed: () {
              ref.read(updateProvider.notifier).dismiss();
              Navigator.of(context).pop();
              launchUrl(Uri.parse(info.url),
                  mode: LaunchMode.externalApplication);
            },
            child: const Text('Download'),
          ),
        ],
      ),
    );
  }
}

/// Dismissible banner list of active announcements.
class AnnouncementBanner extends ConsumerWidget {
  const AnnouncementBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final announcements = ref.watch(announcementsProvider);
    return announcements.when(
      data: (items) {
        if (items.isEmpty) return const SizedBox.shrink();
        return Column(
          children: [
            for (final a in items) _banner(context, ref, a),
            const SizedBox(height: 16),
          ],
        );
      },
      loading: () => const SizedBox.shrink(),
      error: (_, __) => const SizedBox.shrink(),
    );
  }

  Widget _banner(BuildContext context, WidgetRef ref, Announcement a) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.secondaryContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.campaign_outlined,
              color: colors.onSecondaryContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(a.title,
                    style: const TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(a.body),
              ],
            ),
          ),
          IconButton(
            icon: const Icon(Icons.close, size: 18),
            onPressed: () => ref
                .read(settingsProvider.notifier)
                .dismissAnnouncement(a.id),
          ),
        ],
      ),
    );
  }
}

/// Status card: state, server, connected time, throughput.
class ConnectionCard extends ConsumerStatefulWidget {
  const ConnectionCard({super.key});

  @override
  ConsumerState<ConnectionCard> createState() => _ConnectionCardState();
}

class _ConnectionCardState extends ConsumerState<ConnectionCard> {
  Timer? _ticker;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() {});
    });
  }

  @override
  void dispose() {
    _ticker?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final vpn = ref.watch(vpnProvider);
    final colors = Theme.of(context).colorScheme;

    final (label, color, icon) = switch (vpn.phase) {
      ConnectionPhase.connected => (
          'Connected',
          colors.primary,
          Icons.shield
        ),
      ConnectionPhase.connecting => (
          'Connecting…',
          colors.tertiary,
          Icons.shield_outlined
        ),
      ConnectionPhase.reconnecting => (
          'Reconnecting…',
          colors.tertiary,
          Icons.refresh
        ),
      ConnectionPhase.disconnecting => (
          'Disconnecting…',
          colors.tertiary,
          Icons.shield_outlined
        ),
      ConnectionPhase.error => (
          'Connection failed',
          colors.error,
          Icons.error_outline
        ),
      ConnectionPhase.disconnected => (
          'Disconnected',
          colors.onSurfaceVariant,
          Icons.shield_outlined
        ),
    };

    return Card(
      elevation: 0,
      color: colors.surfaceContainerLow,
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Icon(icon, size: 48, color: color),
            const SizedBox(height: 8),
            Text(label,
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.bold, color: color)),
            if (vpn.node != null) ...[
              const SizedBox(height: 8),
              Text(
                '${vpn.node!.city}, ${vpn.node!.region} (${vpn.node!.countryCode.toUpperCase()})',
                style: Theme.of(context).textTheme.bodyLarge,
              ),
            ],
            if (vpn.isConnected) ...[
              const SizedBox(height: 12),
              _StatRow(
                duration: vpn.connectedSince == null
                    ? '—'
                    : _formatDuration(
                        DateTime.now().difference(vpn.connectedSince!)),
                down: _formatBytes(vpn.stats.rxBytes),
                up: _formatBytes(vpn.stats.txBytes),
              ),
            ],
            if (vpn.phase == ConnectionPhase.reconnecting)
              Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text('Attempt ${vpn.reconnectAttempt}',
                    style: Theme.of(context).textTheme.bodySmall),
              ),
          ],
        ),
      ),
    );
  }

  static String _formatDuration(Duration d) {
    final h = d.inHours;
    final m = d.inMinutes.remainder(60);
    final s = d.inSeconds.remainder(60);
    if (h > 0) return '${h}h ${m}m';
    if (m > 0) return '${m}m ${s}s';
    return '${s}s';
  }

  static String _formatBytes(int bytes) {
    if (bytes < 1024) return '$bytes B';
    if (bytes < 1024 * 1024) {
      return '${(bytes / 1024).toStringAsFixed(1)} KB';
    }
    if (bytes < 1024 * 1024 * 1024) {
      return '${(bytes / (1024 * 1024)).toStringAsFixed(1)} MB';
    }
    return '${(bytes / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
  }
}

class _StatRow extends StatelessWidget {
  final String duration;
  final String down;
  final String up;

  const _StatRow(
      {required this.duration, required this.down, required this.up});

  @override
  Widget build(BuildContext context) {
    Widget stat(IconData icon, String label, String value) => Expanded(
          child: Column(
            children: [
              Icon(icon, size: 20),
              const SizedBox(height: 4),
              Text(value,
                  style: const TextStyle(fontWeight: FontWeight.bold)),
              Text(label, style: Theme.of(context).textTheme.bodySmall),
            ],
          ),
        );
    return Row(
      children: [
        stat(Icons.timer_outlined, 'Time', duration),
        stat(Icons.download_outlined, 'Down', down),
        stat(Icons.upload_outlined, 'Up', up),
      ],
    );
  }
}

/// The big one-tap connect button.
class ConnectButton extends ConsumerWidget {
  const ConnectButton({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final vpn = ref.watch(vpnProvider);
    final notifier = ref.read(vpnProvider.notifier);
    final colors = Theme.of(context).colorScheme;

    final label = switch (vpn.phase) {
      ConnectionPhase.connected => 'Disconnect',
      ConnectionPhase.connecting => 'Connecting…',
      ConnectionPhase.disconnecting => 'Disconnecting…',
      ConnectionPhase.reconnecting => 'Reconnecting…',
      ConnectionPhase.error => 'Retry',
      ConnectionPhase.disconnected => 'Connect',
    };

    return SizedBox(
      height: 88,
      child: FilledButton.icon(
        style: FilledButton.styleFrom(
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(24),
          ),
          backgroundColor: vpn.isConnected ? colors.error : colors.primary,
          foregroundColor:
              vpn.isConnected ? colors.onError : colors.onPrimary,
        ),
        onPressed: vpn.isBusy
            ? null
            : () async {
                try {
                  await notifier.toggle();
                } catch (_) {
                  // Errors are surfaced via vpn.errorMessage.
                }
              },
        icon: vpn.isBusy
            ? const SizedBox(
                width: 24,
                height: 24,
                child: CircularProgressIndicator(
                    strokeWidth: 2.5, color: Colors.white),
              )
            : Icon(vpn.isConnected
                ? Icons.power_settings_new
                : Icons.power_settings_new_outlined),
        label: Text(label,
            style: const TextStyle(
                fontSize: 20, fontWeight: FontWeight.bold)),
      ),
    );
  }
}

/// Current server + 'fastest' shortcut.
class QuickServerRow extends ConsumerWidget {
  const QuickServerRow({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nodes = ref.watch(nodesProvider);
    final settings = ref.watch(settingsProvider);
    final vpn = ref.watch(vpnProvider);

    return nodes.when(
      data: (list) {
        if (list.isEmpty) {
          return const Text('No servers available right now.',
              textAlign: TextAlign.center);
        }
        final selected = list.where((n) => n.id == settings.selectedNodeId);
        final node = selected.isEmpty ? list.first : selected.first;
        final fastest =
            list.where((n) => n.latencyMs != null).toList();
        return Column(
          children: [
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.public),
              title: Text(node.displayName),
              subtitle: Text(
                node.latencyMs == null
                    ? 'Measuring…'
                    : '${node.latencyMs} ms · ${node.countryCode.toUpperCase()}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: vpn.isBusy
                  ? null
                  : () => ref
                      .read(settingsProvider.notifier)
                      .selectNode(node.id),
            ),
            if (fastest.isNotEmpty)
              TextButton.icon(
                icon: const Icon(Icons.bolt_outlined),
                label: const Text('Connect to fastest'),
                onPressed: vpn.isBusy
                    ? null
                    : () {
                        final best = fastest.reduce((a, b) =>
                            (a.latencyMs ?? 1 << 30) <
                                    (b.latencyMs ?? 1 << 30)
                                ? a
                                : b);
                        ref
                            .read(settingsProvider.notifier)
                            .selectNode(best.id);
                        ref.read(vpnProvider.notifier).connect(nodeId: best.id);
                      },
              ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => Text('Could not load servers: ${_shortError(e)}',
          textAlign: TextAlign.center),
    );
  }

  String _shortError(Object e) =>
      e.toString().replaceFirst('ApiException', 'Error');
}
