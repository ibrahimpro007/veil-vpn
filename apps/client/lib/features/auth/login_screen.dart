library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/auth_provider.dart';
import '../../widgets/ui_kit.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _obscure = true;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _submit() {
    if (!_form.currentState!.validate()) return;
    ref.read(authProvider.notifier).login(_email.text.trim(), _password.text);
  }

  @override
  Widget build(BuildContext context) {
    final auth = ref.watch(authProvider);
    return FormScaffold(
      title: 'Welcome back',
      subtitle: 'Log in to VeilVPN',
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
                label: 'Password',
                obscure: _obscure,
                textInputAction: TextInputAction.done,
                onSubmitted: (_) => _submit(),
                suffix: IconButton(
                  icon: Icon(
                      _obscure ? Icons.visibility_off : Icons.visibility),
                  onPressed: () => setState(() => _obscure = !_obscure),
                ),
                validator: (v) =>
                    (v == null || v.isEmpty) ? 'Enter your password.' : null,
              ),
            ],
          ),
        ),
        const SizedBox(height: 24),
        LoadingButton(busy: auth.busy, label: 'Log in', onPressed: _submit),
        const SizedBox(height: 8),
        TextButton(
          onPressed: () =>
              ref.read(authProvider.notifier).goTo(AuthStage.forgotPassword),
          child: const Text('Forgot password?'),
        ),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Text("Don't have an account?"),
            TextButton(
              onPressed: () =>
                  ref.read(authProvider.notifier).goTo(AuthStage.register),
              child: const Text('Sign up'),
            ),
          ],
        ),
      ],
    );
  }
}
