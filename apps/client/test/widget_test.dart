/// Widget + provider tests with manual fakes (no codegen, no mockito).
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../lib/app.dart';
import '../lib/core/models.dart';
import '../lib/features/auth/login_screen.dart';
import '../lib/features/home/home_screen.dart';
import '../lib/providers/auth_provider.dart';
import '../lib/providers/nodes_provider.dart';
import '../lib/providers/providers.dart';
import '../lib/providers/update_provider.dart';
import '../lib/providers/vpn_provider.dart';
import '../lib/tunnel/vpn_tunnel.dart';
import 'fakes.dart';

ProviderScope testScope({
  required FakeSecureStore store,
  required FakeVeilApi api,
  required FakeVpnTunnel tunnel,
  required Widget child,
}) {
  return ProviderScope(
    overrides: [
      secureStoreProvider.overrideWithValue(store),
      veilApiClientProvider.overrideWithValue(api),
      vpnTunnelProvider.overrideWithValue(tunnel),
    ],
    child: child,
  );
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() {
    SharedPreferences.setMockInitialValues({});
  });

  group('onboarding', () {
    testWidgets('walks 3 pages then lands on login', (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const VeilApp(),
      ));
      await tester.pumpAndSettle();

      // Starts at onboarding (no stored session).
      expect(find.text('No logs. Ever.'), findsOneWidget);

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('How it works'), findsOneWidget);

      await tester.tap(find.text('Next'));
      await tester.pumpAndSettle();
      expect(find.text('One permission'), findsOneWidget);

      await tester.tap(find.text('Get started'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      await tunnel.dispose();
    });

    testWidgets('skip jumps straight to login', (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const VeilApp(),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Skip'));
      await tester.pumpAndSettle();
      expect(find.byType(LoginScreen), findsOneWidget);
      await tunnel.dispose();
    });
  });

  group('login validation', () {
    testWidgets('rejects invalid email before calling the API',
        (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: FakeVpnTunnel(),
        child: const MaterialApp(home: LoginScreen()),
      ));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextFormField, 'Email'), 'not-an-email');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Password'), 'password123456');
      await tester.tap(find.text('Log in'));
      await tester.pumpAndSettle();

      expect(find.text('Enter a valid email.'), findsOneWidget);
    });

    testWidgets('successful login stores tokens and shows home', (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const VeilApp(),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Skip'));
      await tester.pumpAndSettle();

      await tester.enterText(
          find.widgetWithText(TextFormField, 'Email'), 'user@example.com');
      await tester.enterText(
          find.widgetWithText(TextFormField, 'Password'), 'password123456');
      await tester.tap(find.text('Log in'));
      await tester.pumpAndSettle();

      expect(find.byType(HomeScreen), findsOneWidget);
      expect(await store.readAccessToken(), 'access');
      await tunnel.dispose();
    });
  });

  group('connect flow', () {
    testWidgets('one tap: disconnected -> connecting -> connected',
        (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const MaterialApp(home: HomeScreen()),
      ));
      await tester.pumpAndSettle();

      expect(find.text('Disconnected'), findsOneWidget);

      await tester.tap(find.text('Connect'));
      await tester.pump(); // connecting state
      await tester.pumpAndSettle();

      expect(find.text('Connected'), findsOneWidget);
      expect(find.textContaining('Frankfurt'), findsOneWidget);
      // Device was registered with an on-device keypair.
      expect(await store.readDeviceId(), 'dev_123');
      expect((await store.readWgPrivateKey())?.length, 44);
      // Tunnel got a real WgConfig: node DNS + IPv6 sinkhole.
      final cfg = tunnel.lastConfig!;
      expect(cfg.dns, '10.7.0.1');
      expect(cfg.effectiveAllowedIps, contains('::/0'));
      expect(cfg.effectiveAllowedIps, contains('0.0.0.0/0'));
      await tunnel.dispose();
    });

    testWidgets('unexpected drop triggers auto-reconnect with fresh config',
        (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const MaterialApp(home: HomeScreen()),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(find.text('Connected'), findsOneWidget);
      final firstConnectCalls = api.connectCalls;

      // Simulate the OS killing the tunnel.
      tunnel.simulateUnexpectedDrop('tunnel killed');
      await tester.pump();
      expect(find.text('Reconnecting…'), findsOneWidget);

      // First backoff is 2s; pump past it.
      await tester.pump(const Duration(seconds: 3));
      await tester.pumpAndSettle();

      expect(find.text('Connected'), findsOneWidget);
      // A fresh peer config was fetched for the retry.
      expect(api.connectCalls, greaterThan(firstConnectCalls));
      await tunnel.dispose();
    });

    testWidgets('disconnect returns to idle and clears error', (tester) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);
      final tunnel = FakeVpnTunnel();

      await tester.pumpWidget(testScope(
        store: store,
        api: api,
        tunnel: tunnel,
        child: const MaterialApp(home: HomeScreen()),
      ));
      await tester.pumpAndSettle();

      await tester.tap(find.text('Connect'));
      await tester.pumpAndSettle();
      expect(find.text('Connected'), findsOneWidget);

      await tester.tap(find.text('Disconnect'));
      await tester.pumpAndSettle();
      expect(find.text('Disconnected'), findsOneWidget);
      await tunnel.dispose();
    });
  });

  group('server list', () {
    testWidgets('nodes load from the public endpoint', (_) async {
      final store = FakeSecureStore();
      final api = FakeVeilApi(store);

      final container = ProviderContainer(overrides: [
        secureStoreProvider.overrideWithValue(store),
        veilApiClientProvider.overrideWithValue(api),
      ]);
      addTearDown(container.dispose);

      // Drive the notifier directly (no widgets needed).
      container.read(nodesProvider.notifier);
      await Future<void>.delayed(const Duration(milliseconds: 100));
      final nodes = container.read(nodesProvider).valueOrNull ?? [];
      expect(nodes.length, 2);
      expect(nodes.map((n) => n.id),
          containsAll(['node_fra', 'node_nyc']));
      expect(nodes.every((n) => n.status == NodeStatus.active), isTrue);
    });
  });

  group('pure logic', () {
    test('reconnect backoff schedule', () {
      expect(reconnectDelay(0), const Duration(seconds: 2));
      expect(reconnectDelay(1), const Duration(seconds: 5));
      expect(reconnectDelay(2), const Duration(seconds: 15));
      expect(reconnectDelay(5), const Duration(seconds: 120));
      expect(reconnectDelay(99), const Duration(seconds: 120));
    });

    test('update version comparison', () {
      expect(UpdateNotifier.isNewer('v0.2.0', '0.1.0'), isTrue);
      expect(UpdateNotifier.isNewer('0.1.0', '0.1.0'), isFalse);
      expect(UpdateNotifier.isNewer('0.1.0', '0.2.0'), isFalse);
      expect(UpdateNotifier.isNewer('1.10.0', '1.9.9'), isTrue);
    });

    test('wg-quick config always carries IPv6 sinkhole + node DNS', () {
      final cfg = WgConfig(
        privateKey: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        address: '10.7.3.42',
        dns: '10.7.0.1',
        serverPublicKey: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=',
        endpoint: '203.0.113.10:51820',
      );
      final text = cfg.toWgQuick();
      expect(text, contains('DNS = 10.7.0.1'));
      expect(text, contains('AllowedIPs = 0.0.0.0/0, ::/0'));
      expect(text, contains('PersistentKeepalive = 25'));
      expect(text, contains('[Interface]'));
      expect(text, contains('[Peer]'));
    });
  });
}
