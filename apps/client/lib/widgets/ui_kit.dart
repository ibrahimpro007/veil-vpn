/// Small shared UI pieces.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/google_sign_in_service.dart';
import '../providers/auth_provider.dart';

/// Email validation matching the server's `email` format expectation.
bool isValidEmail(String v) =>
    RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(v.trim());

/// Password policy: min 12 chars (matches openapi.yaml + Zod).
String? validatePassword(String? v) {
  if (v == null || v.isEmpty) return 'Enter your password.';
  if (v.length < 12) return 'Password must be at least 12 characters.';
  if (v.length > 256) return 'Password is too long.';
  return null;
}

class ErrorBanner extends StatelessWidget {
  final String message;
  final VoidCallback? onDismiss;

  const ErrorBanner({super.key, required this.message, this.onDismiss});

  @override
  Widget build(BuildContext context) {
    final colors = Theme.of(context).colorScheme;
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: colors.errorContainer,
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        children: [
          Icon(Icons.error_outline, color: colors.onErrorContainer),
          const SizedBox(width: 8),
          Expanded(
            child: Text(message,
                style: TextStyle(color: colors.onErrorContainer)),
          ),
          if (onDismiss != null)
            IconButton(
              icon: const Icon(Icons.close, size: 18),
              onPressed: onDismiss,
              color: colors.onErrorContainer,
            ),
        ],
      ),
    );
  }
}

class VeilTextField extends StatelessWidget {
  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final bool obscure;
  final TextInputType keyboardType;
  final TextInputAction textInputAction;
  final Widget? suffix;
  final void Function(String)? onSubmitted;

  const VeilTextField({
    super.key,
    required this.controller,
    required this.label,
    this.validator,
    this.obscure = false,
    this.keyboardType = TextInputType.text,
    this.textInputAction = TextInputAction.next,
    this.suffix,
    this.onSubmitted,
  });

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      decoration: InputDecoration(
        labelText: label,
        border: const OutlineInputBorder(),
        suffixIcon: suffix,
      ),
      validator: validator,
      obscureText: obscure,
      keyboardType: keyboardType,
      textInputAction: textInputAction,
      onFieldSubmitted: onSubmitted,
      autocorrect: false,
      enableSuggestions: !obscure,
    );
  }
}

class LoadingButton extends StatelessWidget {
  final bool busy;
  final String label;
  final VoidCallback? onPressed;
  final bool filled;

  const LoadingButton({
    super.key,
    required this.busy,
    required this.label,
    required this.onPressed,
    this.filled = true,
  });

  @override
  Widget build(BuildContext context) {
    final child = busy
        ? const SizedBox(
            height: 20,
            width: 20,
            child: CircularProgressIndicator(strokeWidth: 2),
          )
        : Text(label);
    final style = FilledButton.styleFrom(
      minimumSize: const Size(double.infinity, 52),
    );
    if (filled) {
      return FilledButton(
        style: style,
        onPressed: busy ? null : onPressed,
        child: child,
      );
    }
    return OutlinedButton(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(double.infinity, 52),
      ),
      onPressed: busy ? null : onPressed,
      child: child,
    );
  }
}

/// Narrow centered column used by all full-screen forms.
class FormScaffold extends StatelessWidget {
  final String title;
  final String? subtitle;
  final List<Widget> children;
  final bool scrollable;

  const FormScaffold({
    super.key,
    required this.title,
    this.subtitle,
    required this.children,
    this.scrollable = true,
  });

  @override
  Widget build(BuildContext context) {
    final body = Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const SizedBox(height: 32),
          const Icon(Icons.shield_outlined, size: 56),
          const SizedBox(height: 16),
          Text(title,
              style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                    fontWeight: FontWeight.bold,
                  ),
              textAlign: TextAlign.center),
          if (subtitle != null) ...[
            const SizedBox(height: 8),
            Text(subtitle!,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: Theme.of(context).colorScheme.onSurfaceVariant,
                    ),
                textAlign: TextAlign.center),
          ],
          const SizedBox(height: 32),
          ...children,
        ],
      ),
    );
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 440),
            child: scrollable
                ? SingleChildScrollView(child: body)
                : body,
          ),
        ),
      ),
    );
  }
}

/// "or" divider + Continue with Google button. Renders nothing when the
/// build has no Google client IDs configured (keeps email-only builds
/// clean). Used on the login and register screens.
class GoogleSignInSection extends ConsumerWidget {
  const GoogleSignInSection({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!googleSignInConfigured) return const SizedBox.shrink();
    final auth = ref.watch(authProvider);
    final scheme = Theme.of(context).colorScheme;
    return Column(
      children: [
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(child: Divider(color: scheme.outlineVariant)),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Text('or',
                  style: TextStyle(color: scheme.onSurfaceVariant)),
            ),
            Expanded(child: Divider(color: scheme.outlineVariant)),
          ],
        ),
        const SizedBox(height: 16),
        OutlinedButton(
          style: OutlinedButton.styleFrom(
            minimumSize: const Size(double.infinity, 52),
          ),
          onPressed: auth.busy
              ? null
              : () => ref.read(authProvider.notifier).loginWithGoogle(),
          child: auth.busy
              ? const SizedBox(
                  height: 20,
                  width: 20,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text('G',
                        style: TextStyle(
                            fontSize: 20, fontWeight: FontWeight.bold)),
                    SizedBox(width: 12),
                    Text('Continue with Google'),
                  ],
                ),
        ),
      ],
    );
  }
}
