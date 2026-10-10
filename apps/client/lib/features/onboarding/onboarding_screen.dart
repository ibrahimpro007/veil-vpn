/// 3-page onboarding: privacy/no-logs, how it works, permissions primer.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _pager = PageController();
  int _page = 0;

  static const _pages = [
    (
      Icons.visibility_off_outlined,
      'No logs. Ever.',
      'VeilVPN keeps no activity logs and no connection logs. '
          'Your private key never leaves this device — our servers only ever '
          'see your public key, and connection times are stored at '
          'day granularity only.',
    ),
    (
      Icons.vpn_key_outlined,
      'How it works',
      'Pick a server, tap connect, and all your traffic — including IPv6 and '
          'DNS — is routed through an encrypted WireGuard tunnel to a '
          'no-logs resolver. One tap disconnects, or the kill switch keeps '
          'you safe if the tunnel drops.',
    ),
    (
      Icons.security_outlined,
      'One permission',
      'To protect your traffic, VeilVPN sets up a VPN connection on this '
          'device. Your OS will ask for VPN permission once — VeilVPN itself '
          'never sees your browsing.',
    ),
  ];

  @override
  void dispose() {
    _pager.dispose();
    super.dispose();
  }

  void _finish() {
    ref.read(authProvider.notifier).goTo(AuthStage.login);
  }

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: TextButton(
                onPressed: _finish,
                child: const Text('Skip'),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pager,
                itemCount: _pages.length,
                onPageChanged: (i) => setState(() => _page = i),
                itemBuilder: (context, i) {
                  final (icon, title, body) = _pages[i];
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Container(
                          padding: const EdgeInsets.all(28),
                          decoration: BoxDecoration(
                            color: colors.primaryContainer,
                            shape: BoxShape.circle,
                          ),
                          child: Icon(icon,
                              size: 64, color: colors.onPrimaryContainer),
                        ),
                        const SizedBox(height: 32),
                        Text(title,
                            style: Theme.of(context)
                                .textTheme
                                .headlineSmall
                                ?.copyWith(fontWeight: FontWeight.bold),
                            textAlign: TextAlign.center),
                        const SizedBox(height: 16),
                        Text(body,
                            style: Theme.of(context).textTheme.bodyLarge,
                            textAlign: TextAlign.center),
                      ],
                    ),
                  );
                },
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < _pages.length; i++)
                  AnimatedContainer(
                    duration: const Duration(milliseconds: 200),
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    height: 8,
                    width: _page == i ? 24 : 8,
                    decoration: BoxDecoration(
                      color: _page == i
                          ? colors.primary
                          : colors.surfaceContainerHighest,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.all(24),
              child: LoadingButton(
                busy: false,
                label: _page == _pages.length - 1 ? 'Get started' : 'Next',
                onPressed: () {
                  if (_page == _pages.length - 1) {
                    _finish();
                  } else {
                    _pager.nextPage(
                      duration: const Duration(milliseconds: 300),
                      curve: Curves.easeOut,
                    );
                  }
                },
              ),
            ),
          ],
        ),
      ),
    );
  }
}
