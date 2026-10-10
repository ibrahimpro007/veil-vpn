library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class ResetPasswordScreen extends ConsumerStatefulWidget {
  const ResetPasswordScreen({super.key});

  @override
  ConsumerState<ResetPasswordScreen> createState() =>
      _ResetPasswordScreenState();
}

class _ResetPasswordScreenState extends ConsumerState<ResetPasswordScreen> {
  final _form = GlobalKey<FormState>();
  final _token = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();

  @override
  void dispose() {
    _token.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.currentState!.validate()) return;
    ref
        .read(authProvider.notifier)
        .resetPassword(_token.text, _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    final notifier = ref.read(authProvider.notifier);
    return FormScaffold(
      title: 'Choose a new password',
      subtitle: 'Paste the token from your reset email, then set a new password.',
      children: [
        if (auth.error != null) ...[
          ErrorBanner(message: auth.error!, onDismiss: notifier.clearError),
          const SizedBox(height: 16),
        ],
        Form(
          key: _form,
          child: Column(
            children: [
              VeilTextField(
                controller: _token,
                label: 'Reset token',
                validator: (v) => (v == null || v.trim().isEmpty)
                    ? 'Paste the token from your email.'
                    : null,
              ),
              const SizedBox(height: 16),
              VeilTextField(
                controller: _password,
                label: 'New password (min 12 characters)',
                obscure: true,
                validator: validatePassword,
              ),
              const SizedBox(height: 16),
              VeilTextField(
                controller: _confirm,
                label: 'Confirm new password',
                obscure: true,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                validator: (v) =>
                    v == _password.text ? null : 'Passwords do not match.',
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        LoadingButton(
            busy: auth.busy, label: 'Reset password', onPressed: _submit),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => notifier.goTo(AuthStage.login),
          child: const Text('Back to log in'),
        ),
      ],
    );
  }
}
