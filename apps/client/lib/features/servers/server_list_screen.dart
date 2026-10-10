/// Server list: all nodes with client-measured latency, sorted fastest-first.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/models.dart';
import '../../providers/nodes_provider.dart';
import '../../providers/settings_provider.dart';
import '../../providers/vpn_provider.dart';

class ServerListScreen extends ConsumerStatefulWidget {
  const ServerListScreen({super.key});

  @override
  ConsumerState<ServerListScreen> createState() => _ServerListScreenState();
}

class _ServerListScreenState extends ConsumerState<ServerListScreen> {
  final _search = TextEditingController();
  String _query = '';

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final nodes = ref.watch(nodesProvider);
    final settings = ref.watch(settingsProvider);
    final vpn = ref.watch(vpnProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Servers'), centerTitle: true),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
            child: SearchBar(
              controller: _search,
              hintText: 'Search country or city',
              leading: const Icon(Icons.search),
              onChanged: (v) => setState(() => _query = v.trim().toLowerCase()),
              trailing: _query.isEmpty
                  ? null
                  : [
                      IconButton(
                        icon: const Icon(Icons.clear),
                        onPressed: () {
                          _search.clear();
                          setState(() => _query = '');
                        },
                      ),
                    ],
            ),
          ),
          Padding(
            padding:
                const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                Text(
                  'Latency is measured from this device.',
                  style: Theme.of(context).textTheme.bodySmall,
                ),
                const Spacer(),
                IconButton(
                  tooltip: 'Re-measure latency',
                  icon: const Icon(Icons.refresh, size: 20),
                  onPressed: () =>
                      ref.read(nodesProvider.notifier).measureLatency(),
                ),
              ],
            ),
          ),
          Expanded(
            child: nodes.when(
              data: (list) {
                final filtered = _query.isEmpty
                    ? list
                    : list
                        .where((n) =>
                            n.displayName.toLowerCase().contains(_query) ||
                            n.countryCode.toLowerCase().contains(_query))
                        .toList();
                if (filtered.isEmpty) {
                  return const Center(child: Text('No servers match.'));
                }
                return RefreshIndicator(
                  onRefresh: () =>
                      ref.read(nodesProvider.notifier).refresh(),
                  child: ListView.builder(
                    itemCount: filtered.length,
                    itemBuilder: (context, i) =>
                        _nodeTile(context, ref, filtered[i], settings, vpn),
                  ),
                );
              },
              loading: () =>
                  const Center(child: CircularProgressIndicator()),
              error: (e, _) => Center(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('Could not load servers.\n$e',
                        textAlign: TextAlign.center),
                    const SizedBox(height: 12),
                    FilledButton(
                      onPressed: () =>
                          ref.read(nodesProvider.notifier).refresh(),
                      child: const Text('Retry'),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _nodeTile(BuildContext context, WidgetRef ref, VpnNode node,
      AppSettings settings, VpnUiState vpn) {
    final selected = settings.selectedNodeId == node.id ||
        (settings.selectedNodeId == null && vpn.node?.id == node.id);
    final colors = Theme.of(context).colorScheme;
    return ListTile(
      leading: CircleAvatar(
        backgroundColor:
            selected ? colors.primary : colors.surfaceContainerHighest,
        child: Text(
          node.countryCode.toUpperCase(),
          style: TextStyle(
            fontSize: 11,
            fontWeight: FontWeight.bold,
            color: selected
                ? colors.onPrimary
                : colors.onSurfaceVariant,
          ),
        ),
      ),
      title: Text(node.displayName),
      subtitle: Text(
        node.status == NodeStatus.draining
            ? 'Draining — ${node.latencyMs == null ? 'measuring…' : '${node.latencyMs} ms'}'
            : (node.latencyMs == null
                ? 'Measuring latency…'
                : '${node.latencyMs} ms'),
      ),
      trailing: selected
          ? Icon(Icons.check_circle, color: colors.primary)
          : _latencyChip(context, node.latencyMs),
      enabled: !vpn.isBusy,
      onTap: () async {
        await ref.read(settingsProvider.notifier).selectNode(node.id);
        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text('Selected ${node.displayName}')),
          );
        }
      },
    );
  }

  Widget? _latencyChip(BuildContext context, int? ms) {
    if (ms == null) return null;
    final colors = Theme.of(context).colorScheme;
    final color = ms < 100
        ? Colors.green
        : ms < 250
            ? Colors.orange
            : colors.error;
    return Chip(
      label: Text('$ms ms', style: const TextStyle(fontSize: 12)),
      side: BorderSide(color: color),
      visualDensity: VisualDensity.compact,
    );
  }
}
