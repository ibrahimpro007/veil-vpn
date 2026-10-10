/// Settings: kill switch, auto-reconnect, launch at login, split tunneling,
/// update check, privacy/GDPR, about.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import '../../core/api_client.dart';
import '../../core/config.dart';
import '../../core/platform_info.dart';
import '../../core/platform_settings.dart';
import '../../providers/auth_provider.dart';
import '../../providers/providers.dart';
import '../../providers/settings_provider.dart';
import '../../providers/update_provider.dart';
import '../../widgets/ui_kit.dart';

class SettingsScreen extends ConsumerWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final settings = ref.watch(settingsProvider);
    final notifier = ref.read(settingsProvider.notifier);

    return Scaffold(
      appBar: AppBar(title: const Text('Settings'), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          _section(context, 'Connection'),
          SwitchListTile(
            title: const Text('Kill switch'),
            subtitle: Text(_killSwitchSubtitle()),
            value: settings.killSwitch,
            onChanged: (v) => _applyWithNote(
              context,
              () => notifier.setKillSwitch(v),
              PlatformSettings.applyKillSwitch(v),
            ),
          ),
          SwitchListTile(
            title: const Text('Auto-reconnect'),
            subtitle: const Text(
                'Automatically reconnect if the tunnel drops unexpectedly.'),
            value: settings.autoReconnect,
            onChanged: notifier.setAutoReconnect,
          ),
          SwitchListTile(
            title: const Text('Launch at login'),
            subtitle: Text(_launchSubtitle()),
            value: settings.launchAtLogin,
            onChanged: (v) => _applyWithNote(
              context,
              () => notifier.setLaunchAtLogin(v),
              PlatformSettings.applyLaunchAtLogin(v),
            ),
          ),
          SwitchListTile(
            title: const Text('Connect on launch'),
            subtitle: const Text(
                'Automatically connect when the app starts.'),
            value: settings.connectOnLaunch,
            onChanged: notifier.setConnectOnLaunch,
          ),
          _section(context, 'Privacy'),
          const ListTile(
            leading: Icon(Icons.dns_outlined),
            title: Text('DNS leak protection'),
            subtitle: Text(
              'Always on. All DNS goes through the in-tunnel resolver '
              '(10.7.0.1); IPv6 is routed into the tunnel and dropped '
              'server-side so it can never leak around the VPN.',
            ),
            trailing: Icon(Icons.lock, color: Colors.green),
          ),
          if (Platform.isAndroid)
            ListTile(
              leading: const Icon(Icons.apps_outlined),
              title: const Text('Split tunneling (per-app)'),
              subtitle: Text(
                settings.excludedApps.isEmpty
                    ? 'All apps use the VPN.'
                    : '${settings.excludedApps.length} app(s) bypass the VPN.',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _editExcludedApps(context, ref),
            ),
          if (isDesktop)
            ListTile(
              leading: const Icon(Icons.route_outlined),
              title: const Text('Split tunneling (CIDR allowlist)'),
              subtitle: Text(
                settings.allowedIpsOverride.isEmpty
                    ? 'Full tunnel: 0.0.0.0/0, ::/0'
                    : 'Allowed: ${settings.allowedIpsOverride.join(', ')}',
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _editAllowedIps(context, ref),
            ),
          _section(context, 'Updates'),
          ListTile(
            leading: const Icon(Icons.system_update_outlined),
            title: const Text('Check for updates'),
            subtitle: AppConfig.isDirect
                ? const Text('Direct builds check GitHub Releases.')
                : const Text(
                    'Store builds update through the app store.'),
            trailing: const Icon(Icons.chevron_right),
            onTap: AppConfig.isDirect
                ? () => _checkUpdates(context, ref)
                : null,
          ),
          _section(context, 'Data'),
          ListTile(
            leading: const Icon(Icons.download_outlined),
            title: const Text('Export my data (GDPR)'),
            onTap: () => _exportData(context, ref),
          ),
          ListTile(
            leading: Icon(Icons.delete_forever_outlined,
                color: Theme.of(context).colorScheme.error),
            title: Text('Delete my account',
                style: TextStyle(
                    color: Theme.of(context).colorScheme.error)),
            subtitle: const Text(
                'Permanently deletes your account and all personal data.'),
            onTap: () => _deleteAccount(context, ref),
          ),
          _section(context, 'About'),
          FutureBuilder<PackageInfo>(
            future: PackageInfo.fromPlatform(),
            builder: (context, snap) => ListTile(
              leading: const Icon(Icons.info_outline),
              title: const Text('VeilVPN'),
              subtitle: Text(
                'Version ${snap.data?.version ?? '…'} '
                '(${AppConfig.flavor} build)\nNo-logs VPN · WireGuard®',
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _section(BuildContext context, String title) => Padding(
        padding: const EdgeInsets.only(top: 16, bottom: 4),
        child: Text(title,
            style: Theme.of(context)
                .textTheme
                .titleSmall
                ?.copyWith(color: Theme.of(context).colorScheme.primary)),
      );

  String _killSwitchSubtitle() {
    if (Platform.isAndroid) {
      return 'Opens system VPN settings so you can enable Always-on VPN + '
          ''Block connections without VPN'.';
    }
    if (Platform.isWindows) {
      return 'Blocks all traffic outside the tunnel via Windows Firewall.';
    }
    if (Platform.isMacOS) {
      return 'Installs on-demand rules that drop traffic when the VPN is down.';
    }
    return 'Not supported on this platform yet.';
  }

  String _launchSubtitle() {
    if (Platform.isAndroid) {
      return 'Offer to reconnect after the device reboots.';
    }
    return 'Start VeilVPN when you log in.';
  }

  /// Runs the preference write + the OS side effect, then shows what happened.
  Future<void> _applyWithNote(
    BuildContext context,
    Future<void> Function() save,
    Future<String> sideEffect,
  ) async {
    await save();
    String note;
    try {
      note = await sideEffect;
    } catch (e) {
      note = 'Could not apply at OS level: $e';
    }
    if (context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(note)));
    }
  }

  Future<void> _editExcludedApps(BuildContext context, WidgetRef ref) async {
    final settings = ref.read(settingsProvider);
    final controller =
        TextEditingController(text: settings.excludedApps.join('\n'));
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Apps that bypass the VPN'),
        content: SizedBox(
          width: 400,
          child: TextField(
            controller: controller,
            maxLines: 6,
            decoration: const InputDecoration(
              hintText: 'One Android package name per line\ne.g. com.example.app',
              border: OutlineInputBorder(),
            ),
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Save')),
        ],
      ),
    );
    if (ok == true) {
      final apps = controller.text
          .split('\n')
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
      await ref.read(settingsProvider.notifier).setExcludedApps(apps);
    }
    controller.dispose();
  }

  Future<void> _editAllowedIps(BuildContext context, WidgetRef ref) async {
    final settings = ref.read(settingsProvider);
    final controller =
        TextEditingController(text: settings.allowedIpsOverride.join(', '));
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Custom AllowedIPs'),
        content: SizedBox(
          width: 400,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Comma-separated CIDRs routed through the tunnel. '
                'Leave empty for the full tunnel (0.0.0.0/0, ::/0). '
                '::/0 is always added so IPv6 cannot leak.',
              ),
              const SizedBox(height: 12),
              TextField(
                controller: controller,
                decoration: const InputDecoration(
                  hintText: 'e.g. 10.0.0.0/8, 192.168.0.0/16',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Save')),
        ],
      ),
    );
    if (ok == true) {
      final cidrs = controller.text
          .split(',')
          .map((e) => e.trim())
          .where((e) => e.isNotEmpty)
          .toList();
      final bad = cidrs.where((c) => !_looksLikeCidr(c)).toList();
      if (bad.isNotEmpty && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Ignored invalid CIDR(s): ${bad.join(', ')}')),
        );
      }
      await ref
          .read(settingsProvider.notifier)
          .setAllowedIpsOverride(cidrs.where(_looksLikeCidr).toList());
    }
    controller.dispose();
  }

  bool _looksLikeCidr(String s) =>
      RegExp(r'^[0-9a-fA-F:.]+\/\d{1,3}$').hasMatch(s);

  Future<void> _checkUpdates(BuildContext context, WidgetRef ref) async {
    await ref.read(updateProvider.notifier).check();
    final state = ref.read(updateProvider);
    if (!context.mounted) return;
    final info = state.valueOrNull;
    state.when(
      data: (_) {
        final message = info == null
            ? 'Could not check for updates. Try again later.'
            : info.available
                ? 'Update available: ${info.latestVersion}.'
                : 'You are on the latest version (${info.currentVersion}).';
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(message)));
      },
      loading: () {},
      error: (e, _) => ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
              content: Text('Update check failed. Try again later.'))),
    );
  }

  Future<void> _exportData(BuildContext context, WidgetRef ref) async {
    final api = ref.read(veilApiClientProvider);
    try {
      final data = await api.exportData();
      final dir = await getApplicationDocumentsDirectory();
      final file = File(
          '${dir.path}/veil-data-export-${DateTime.now().millisecondsSinceEpoch}.json');
      await file.writeAsString(
          const JsonEncoder.withIndent('  ').convert(data));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Export saved to ${file.path}')),
        );
      }
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }

  Future<void> _deleteAccount(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Delete account?'),
        content: const Text(
          'This permanently deletes your account, devices, and subscription '
          'data. This cannot be undone.',
        ),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel')),
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Theme.of(context).colorScheme.error,
            ),
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Delete forever'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    try {
      await ref.read(veilApiClientProvider).deleteAccount();
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
      return;
    }
    await ref.read(authProvider.notifier).logout();
  }
}
