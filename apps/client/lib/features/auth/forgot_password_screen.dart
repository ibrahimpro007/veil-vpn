library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class ForgotPasswordScreen extends ConsumerStatefulWidget {
  const ForgotPasswordScreen({super.key});

  @override
  ConsumerState<ForgotPasswordScreen> createState() =>
      _ForgotPasswordScreenState();
}

class _ForgotPasswordScreenState extends ConsumerState<ForgotPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  bool _sent = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final notifier = ref.read(authProvider.notifier);
    return FormScaffold(
      title: 'Reset password',
      subtitle: _sent
          ? 'If an account exists for that email, a reset link is on its way.'
          : 'Enter your account email and we\'ll send a reset link.',
      children: [
        if (auth.error != null) ...[
          ErrorBanner(message: auth.error!, onDismiss: notifier.clearError),
          const SizedBox(height: 16),
        ],
        if (!_sent) ...[
          Form(
            key: _form,
            child: VeilTextField(
              controller: _email,
              label: 'Email',
              keyboardType: TextInputType.emailAddress,
              textInputAction: TextInputAction.done,
              validator: (v) =>
                  isValidEmail(v ?? '') ? null : 'Enter a valid email.',
            ),
          ),
          const SizedBox(height: 24),
          LoadingButton(
            busy: auth.busy,
            label: 'Send reset link',
            onPressed: () async {
              if (!_form.currentState!.validate()) return;
              await notifier.forgotPassword(_email.text.trim());
              if (mounted && ref.read(authProvider).error == null) {
                setState(() => _sent = true);
              }
            },
          ),
        ] else ...[
          LoadingButton(
            busy: false,
            label: 'I have a reset token',
            filled: false,
            onPressed: () => notifier.goTo(AuthStage.resetPassword),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => notifier.goTo(AuthStage.login),
          child: const Text('Back to log in'),
        ),
      ],
    );
  }
}
