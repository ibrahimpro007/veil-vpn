/// Shown after registration while the email is unverified.
/// The user taps the link in their email, then "I've verified my email"
/// (re-checks `GET /v1/me`), or pastes the token manually.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class VerifyEmailScreen extends ConsumerStatefulWidget {
  const VerifyEmailScreen({super.key});

  @override
  ConsumerState<VerifyEmailScreen> createState() => _VerifyEmailScreenState();
}

class _VerifyEmailScreenState extends ConsumerState<VerifyEmailScreen> {
  final _token = TextEditingController();
  bool _showTokenField = false;

  @override
  void dispose() {
    _token.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final notifier = ref.read(authProvider.notifier);
    return FormScaffold(
      title: 'Verify your email',
      subtitle:
          'We sent a verification link to ${auth.pendingEmail ?? 'your email'}. '
          'Tap it, then continue below.',
      children: [
        if (auth.error != null) ...[
          ErrorBanner(
              message: auth.error!, onDismiss: notifier.clearError),
          const SizedBox(height: 16),
        ],
        LoadingButton(
          busy: auth.busy,
          label: "I've verified my email",
          onPressed: notifier.checkEmailVerified,
        ),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () =>
              setState(() => _showTokenField = !_showTokenField),
          child: Text(_showTokenField
              ? 'Hide manual token entry'
              : 'Paste verification token manually'),
        ),
        if (_showTokenField) ...[
          const SizedBox(height: 8),
          VeilTextField(
            controller: _token,
            label: 'Verification token',
            textInputAction: TextInputAction.done,
            onSubmitted: (_) {
              if (_token.text.trim().isNotEmpty) {
                notifier.verifyWithToken(_token.text);
              }
            },
            validator: (v) => (v == null || v.trim().isEmpty)
                ? 'Paste the token from your email.'
                : null,
          ),
          const SizedBox(height: 12),
          LoadingButton(
            busy: auth.busy,
            label: 'Verify token',
            filled: false,
            onPressed: () {
              if (_token.text.trim().isNotEmpty) {
                notifier.verifyWithToken(_token.text);
              }
            },
          ),
        ],
        const SizedBox(height: 16),
        TextButton(
          onPressed: () => notifier.goTo(AuthStage.login),
          child: const Text('Back to log in'),
        ),
      ],
    );
  }
}
