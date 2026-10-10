library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class RegisterScreen extends ConsumerStatefulWidget {
  const RegisterScreen({super.key});

  @override
  ConsumerState<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends ConsumerState<RegisterScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _confirm.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.currentState!.validate()) return;
    ref
        .read(authProvider.notifier)
        .register(_email.text.trim(), _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    return FormScaffold(
      title: 'Create account',
      subtitle: 'Private by default. No logs, ever.',
      children: [
        if (auth.error != null) ...[
          ErrorBanner(
            message: auth.error!,
            onDismiss: () => ref.read(authProvider.notifier).clearError(),
          ),
          const SizedBox(height: 16),
        ],
        Form(
          key: _form,
          child: Column(
            children: [
              VeilTextField(
                controller: _email,
                label: 'Email',
                keyboardType: TextInputType.emailAddress,
                validator: (v) =>
                    isValidEmail(v ?? '') ? null : 'Enter a valid email.',
              ),
              const SizedBox(height: 16),
              VeilTextField(
                controller: _password,
                label: 'Password (min 12 characters)',
                obscure: _obscure,
                suffix: IconButton(
                  icon: Icon(
                      _obscure ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
                validator: validatePassword,
              ),
              const SizedBox(height: 16),
              VeilTextField(
                controller: _confirm,
                label: 'Confirm password',
                obscure: _obscure,
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
            busy: auth.busy, label: 'Create account', onPressed: _submit),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text('Already have an account?'),
            TextButton(
              onPressed: () =>
                  ref.read(authProvider.notifier).goTo(AuthStage.login),
              child: const Text('Log in'),
            ),
          ],
        ),
      ],
    );
  }
}
