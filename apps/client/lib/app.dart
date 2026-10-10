/// VeilVPN root widget: Material 3, stage-driven navigation.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'features/account/account_screen.dart';
import 'features/auth/forgot_password_screen.dart';
import 'features/auth/login_screen.dart';
import 'features/auth/register_screen.dart';
import 'features/auth/reset_password_screen.dart';
import 'features/auth/verify_email_screen.dart';
import 'features/home/home_screen.dart';
import 'features/onboarding/onboarding_screen.dart';
import 'features/servers/server_list_screen.dart';
import 'features/settings/settings_screen.dart';
import 'providers/auth_provider.dart';
import 'providers/settings_provider.dart';
import 'providers/vpn_provider.dart';

class VeilApp extends ConsumerWidget {
  const VeilApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final auth = ref.watch(authProvider);
    return MaterialApp(
      title: 'VeilVPN',
      debugShowCheckedModeBanner: false,
      theme: _lightTheme,
      darkTheme: _darkTheme,
      themeMode: ThemeMode.system,
      home: _stageHome(auth.stage),
    );
  }

  Widget _stageHome(AuthStage stage) {
    switch (stage) {
      case AuthStage.checking:
        return const _SplashScreen();
      case AuthStage.onboarding:
        return const OnboardingScreen();
      case AuthStage.login:
        return const LoginScreen();
      case AuthStage.register:
        return const RegisterScreen();
      case AuthStage.verifyEmail:
        return const VerifyEmailScreen();
      case AuthStage.forgotPassword:
        return const ForgotPasswordScreen();
      case AuthStage.resetPassword:
        return const ResetPasswordScreen();
      case AuthStage.authenticated:
        return const AppShell();
    }
  }
}

final _lightTheme = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF0E7C66),
    brightness: Brightness.light,
  ),
);

final _darkTheme = ThemeData(
  useMaterial3: true,
  colorScheme: ColorScheme.fromSeed(
    seedColor: const Color(0xFF00D1A1),
    brightness: Brightness.dark,
  ).copyWith(
    surface: const Color(0xFF0B1116),
    surfaceContainerLowest: const Color(0xFF070B0E),
  ),
);

class _SplashScreen extends StatelessWidget {
  const _SplashScreen();

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.shield_outlined, size: 64),
            SizedBox(height: 16),
            Text('VeilVPN',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            SizedBox(height: 16),
            CircularProgressIndicator(),
          ],
        ),
      ),
    );
  }
}

/// Adaptive shell: bottom nav on mobile, navigation rail on desktop.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({super.key});

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  int _index = 0;
  bool _autoConnectTried = false;

  @override
  void initState() {
    super.initState();
    // 'Connect on launch': one attempt per app start.
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_autoConnectTried) return;
      _autoConnectTried = true;
      final settings = ref.read(settingsProvider);
      final vpn = ref.read(vpnProvider);
      if (settings.connectOnLaunch &&
          !vpn.isConnected &&
          !vpn.isBusy) {
        ref.read(vpnProvider.notifier).connect();
      }
    });
  }

  static const _pages = [
    HomeScreen(),
    ServerListScreen(),
    AccountScreen(),
    SettingsScreen(),
  ];

  static const _destinations = [
    (Icons.shield_outlined, Icons.shield, 'Home'),
    (Icons.public_outlined, Icons.public, 'Servers'),
    (Icons.person_outline, Icons.person, 'Account'),
    (Icons.settings_outlined, Icons.settings, 'Settings'),
  ];

  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= 800;
        final body = IndexedStack(index: _index, children: _pages);
        if (wide) {
          return Scaffold(
            body: Row(
              children: [
                NavigationRail(
                  selectedIndex: _index,
                  onDestinationSelected: (i) => setState(() => _index = i),
                  labelType: NavigationRailLabelType.all,
                  destinations: [
                    for (final d in _destinations)
                      NavigationRailDestination(
                        icon: Icon(d.$1),
                        selectedIcon: Icon(d.$2),
                        label: Text(d.$3),
                      ),
                  ],
                ),
                const VerticalDivider(width: 1),
                Expanded(
                  child: Center(
                    child: ConstrainedBox(
                      constraints: const BoxConstraints(maxWidth: 720),
                      child: body,
                    ),
                  ),
                ),
              ],
            ),
          );
        }
        return Scaffold(
          body: body,
          bottomNavigationBar: NavigationBar(
            selectedIndex: _index,
            onDestinationSelected: (i) => setState(() => _index = i),
            destinations: [
              for (final d in _destinations)
                NavigationDestination(
                  icon: Icon(d.$1),
                  selectedIcon: Icon(d.$2),
                  label: d.$3,
                ),
            ],
          ),
        );
      },
    );
  }
}
