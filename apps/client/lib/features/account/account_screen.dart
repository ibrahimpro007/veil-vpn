/// Account: profile, subscription status, device management, logout.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../billing/store_billing.dart';
import '../../core/api_client.dart';
import '../../core/models.dart';
import '../../providers/auth_provider.dart';
import '../../providers/providers.dart';
import '../../providers/vpn_provider.dart';
import '../../widgets/ui_kit.dart';

class AccountScreen extends ConsumerWidget {
  const AccountScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    final sub = ref.watch(subscriptionProvider);
    final user = auth.user;

    return Scaffold(
      appBar: AppBar(title: const Text('Account'), centerTitle: true),
      body: ListView(
        padding: const EdgeInsets.all(20),
        children: [
          if (user != null)
            Card(
              child: ListTile(
                leading: const Icon(Icons.person_outline, size: 32),
                title: Text(user.email),
                subtitle: Text(
                  'Status: ${user.status.name}'
                  '${user.emailVerified ? '' : ' · email unverified'}',
                ),
              ),
            ),
          const SizedBox(height: 16),
          Text('Subscription',
              style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          sub.when(
            data: (view) => _SubscriptionCard(view: view),
            loading: () =>
                const Center(child: CircularProgressIndicator()),
            error: (e, _) => ErrorBanner(message: 'Could not load subscription: ${_short(e)}'),
          ),
          const SizedBox(height: 16),
          Text('Devices', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          const _DeviceList(),
          const SizedBox(height: 24),
          LoadingButton(
            busy: auth.busy,
            label: 'Log out',
            filled: false,
            onPressed: () => _confirmLogout(context, ref),
          ),
        ],
      ),
    );
  }

  String _short(Object e) =>
      e is ApiException ? e.message : e.toString();

  Future<void> _confirmLogout(BuildContext context, WidgetRef ref) async {
    final vpn = ref.read(vpnProvider);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Log out?'),
        content: Text(vpn.isConnected
            ? 'You are connected. Logging out will disconnect the VPN.'
            : 'Log out of VeilVPN on this device?'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Log out')),
        ],
      ),
    );
    if (ok == true) {
      if (ref.read(vpnProvider).isConnected) {
        await ref.read(vpnProvider.notifier).disconnect();
      }
      await ref.read(authProvider.notifier).logout();
    }
  }
}

class _SubscriptionCard extends ConsumerWidget {
  final SubscriptionView view;

  const _SubscriptionCard({required this.view});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final entitlement = view.entitlement;
    final subscription = view.subscription;
    final colors = Theme.of(context).colorScheme;

    if (entitlement == null && subscription == null) {
      return Card(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('No active subscription',
                  style: TextStyle(fontWeight: FontWeight.bold)),
              const SizedBox(height: 4),
              const Text(
                  'You are on the free tier. Subscribe to connect.'),
              const SizedBox(height: 12),
              const _SubscribeButtons(),
            ],
          ),
        ),
      );
    }

    final status = subscription?.status ?? entitlement?.status;
    final statusColor = switch (status) {
      SubscriptionStatus.active || SubscriptionStatus.trialing =>
        colors.primary,
      SubscriptionStatus.pastDue => Colors.orange,
      _ => colors.error,
    };
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    _planName(subscription?.planSlug ?? entitlement?.planSlug),
                    style: const TextStyle(
                        fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                ),
                Chip(
                  label: Text(status?.name ?? 'unknown'),
                  side: BorderSide(color: statusColor),
                ),
              ],
            ),
            const SizedBox(height: 8),
            if (entitlement != null)
              Text('Devices: up to ${entitlement.deviceLimit}'),
            if (subscription?.currentPeriodEnd != null)
              Text(
                'Renews: ${_date(subscription!.currentPeriodEnd!)}',
              ),
            if (subscription?.graceUntil != null)
              Text('Grace until: ${_date(subscription!.graceUntil!)}'),
            const SizedBox(height: 12),
            _ManageButton(),
          ],
        ),
      ),
    );
  }

  String _planName(String? slug) => switch (slug) {
        'plan_monthly' => 'Veil Monthly',
        'plan_yearly' => 'Veil Yearly',
        'plan_free_trial' => 'Veil Trial',
        _ => slug ?? 'VeilVPN',
      };

  String _date(int epochSeconds) {
    final d = DateTime.fromMillisecondsSinceEpoch(epochSeconds * 1000);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }
}

class _SubscribeButtons extends ConsumerWidget {
  const _SubscribeButtons();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        FilledButton(
          onPressed: () => _checkout(ref, 'plan_monthly', 'stripe'),
          child: const Text('Subscribe Monthly — \$4.99/mo'),
        ),
        const SizedBox(height: 8),
        OutlinedButton(
          onPressed: () => _checkout(ref, 'plan_yearly', 'stripe'),
          child: const Text('Subscribe Yearly — \$49.99/yr'),
        ),
      ],
    );
  }

  Future<void> _checkout(
      WidgetRef ref, String planId, String provider) async {
    final api = ref.read(veilApiClientProvider);
    final billing = StoreBilling(api);
    try {
      await billing.checkoutOnWeb(planId: planId, provider: provider);
    } catch (e) {
      // The UI shows errors via ScaffoldMessenger from the caller context;
      // here we just rethrow for the button handler.
      rethrow;
    } finally {
      await billing.dispose();
    }
  }
}

class _ManageButton extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return OutlinedButton.icon(
      icon: const Icon(Icons.open_in_new, size: 18),
      label: const Text('Manage / renew subscription'),
      onPressed: () async {
        final billing = StoreBilling(ref.read(veilApiClientProvider));
        try {
          await billing.openManageSubscription();
        } on ApiException catch (e) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text(e.message)),
            );
          }
        } finally {
          await billing.dispose();
        }
      },
    );
  }
}

class _DeviceList extends ConsumerWidget {
  const _DeviceList();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final devices = ref.watch(devicesProvider);
    return devices.when(
      data: (list) {
        if (list.isEmpty) {
          return const Card(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Text('No devices registered yet.'),
            ),
          );
        }
        return Column(
          children: [
            for (final d in list)
              Card(
                child: ListTile(
                  leading: Icon(_platformIcon(d.platform)),
                  title: Text(d.name),
                  subtitle: Text(
                      '${d.platform} · added ${_date(d.createdAt)}'),
                  trailing: IconButton(
                    icon: const Icon(Icons.delete_outline),
                    tooltip: 'Remove device',
                    onPressed: () => _revoke(context, ref, d),
                  ),
                ),
              ),
          ],
        );
      },
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => ErrorBanner(
          message:
              'Could not load devices: ${e is ApiException ? e.message : e}'),
    );
  }

  IconData _platformIcon(String platform) => switch (platform) {
        'android' => Icons.smartphone_outlined,
        'windows' => Icons.laptop_windows_outlined,
        'macos' => Icons.laptop_mac_outlined,
        'ios' => Icons.phone_iphone_outlined,
        _ => Icons.devices_outlined,
      };

  String _date(int epochSeconds) {
    final d = DateTime.fromMillisecondsSinceEpoch(epochSeconds * 1000);
    return '${d.year}-${d.month.toString().padLeft(2, '0')}-${d.day.toString().padLeft(2, '0')}';
  }

  Future<void> _revoke(
      BuildContext context, WidgetRef ref, Device device) async {
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Remove device?'),
        content: Text(
            '“${device.name}” will be revoked and its VPN peer removed.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancel')),
          FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Remove')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(veilApiClientProvider).deleteDevice(device.id);
      ref.invalidate(devicesProvider);
    } on ApiException catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context)
            .showSnackBar(SnackBar(content: Text(e.message)));
      }
    }
  }
}
