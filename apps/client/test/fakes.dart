/// Manual fakes for widget/provider tests (no codegen).
library;

import '../lib/core/api_client.dart';
import '../lib/core/models.dart';
import '../lib/core/secure_store.dart';

/// In-memory SecureStore: overrides every method, never touches platform
/// channels.
class FakeSecureStore extends SecureStore {
  final _map = <String, String>{};

  FakeSecureStore() : super();

  @override
  Future<void> writeTokens(
          {required String accessToken,
          required String refreshToken}) async {
    _map['veil.access_token'] = accessToken;
    _map['veil.refresh_token'] = refreshToken;
  }

  @override
  Future<String?> readAccessToken() async => _map['veil.access_token'];

  @override
  Future<String?> readRefreshToken() async => _map['veil.refresh_token'];

  @override
  Future<bool> hasSession() async =>
      (_map['veil.refresh_token'] ?? '').isNotEmpty;

  @override
  Future<void> clearTokens() async {
    _map.remove('veil.access_token');
    _map.remove('veil.refresh_token');
  }

  @override
  Future<void> writeWgPrivateKey(String v) async =>
      _map['veil.wg_private_key'] = v;

  @override
  Future<String?> readWgPrivateKey() async =>
      _map['veil.wg_private_key'];

  @override
  Future<void> writeWgPublicKey(String v) async =>
      _map['veil.wg_public_key'] = v;

  @override
  Future<String?> readWgPublicKey() async => _map['veil.wg_public_key'];

  @override
  Future<void> writeDeviceId(String id) async =>
      _map['veil.device_id'] = id;

  @override
  Future<String?> readDeviceId() async => _map['veil.device_id'];

  @override
  Future<void> writeHelperToken(String token) async =>
      _map['veil.helper_token'] = token;

  @override
  Future<String?> readHelperToken() async =>
      _map['veil.helper_token'];

  @override
  Future<void> clearAll() async => _map.clear();
}

/// Scriptable fake of the whole API surface.
class FakeVeilApi implements VeilApiClient {
  final FakeSecureStore store;

  bool canConnect = true;
  bool failConnectOnce = false;
  int connectCalls = 0;
  int refreshCalls = 0;

  FakeVeilApi(this.store);

  static const _privateKey =
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; // 44 chars
  static const _publicKey =
      'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='; // 44 chars

  Map<String, dynamic> _peerJson(String nodeId) => {
        'address': '10.7.3.42',
        'subnet': '10.7.0.0/24',
        'serverPublicKey': _publicKey,
        'endpoint': '203.0.113.10:51820',
        'dns': '10.7.0.1',
        'allowedIps': ['0.0.0.0/0'],
        'node': {
          'id': nodeId,
          'countryCode': 'de',
          'city': 'Frankfurt',
          'region': 'EU Central',
        },
        'expiresAt': 9999999999,
      };

  @override
  Future<({bool emailVerificationRequired, String userId})> register(
      String email, String password) async {
    // Mirror the real client: registration does NOT log in by itself.
    return (userId: 'user_123', emailVerificationRequired: true);
  }

  @override
  Future<AuthTokens> login(String email, String password) async {
    if (email == 'fail@example.com') {
      throw const AuthException(
          code: 'invalid_credentials', message: 'Invalid credentials.');
    }
    const tokens = AuthTokens(
        accessToken: 'access', refreshToken: 'refresh', expiresIn: 900);
    await store.writeTokens(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken);
    return tokens;
  }

  @override
  Future<AuthTokens> refresh(String refreshToken) async {
    refreshCalls++;
    const tokens = AuthTokens(
        accessToken: 'access2', refreshToken: 'refresh2', expiresIn: 900);
    await store.writeTokens(
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken);
    return tokens;
  }

  @override
  Future<void> logout(String refreshToken) async => store.clearAll();

  @override
  Future<bool> verifyEmail(String token) async => token == 'good-token';

  @override
  Future<void> forgotPassword(String email) async {}

  @override
  Future<void> resetPassword(String token, String newPassword) async {}

  @override
  Future<UserProfile> getMe() async => const UserProfile(
        id: 'user_123',
        email: 'user@example.com',
        emailVerified: true,
        status: UserStatus.active,
        createdAt: 1700000000,
      );

  @override
  Future<UserProfile> updateMe({String? email}) => getMe();

  @override
  Future<List<Device>> listDevices() async => const [];

  @override
  Future<Device> registerDevice(
      {required String name,
      required String platform,
      required String wgPublicKey}) async {
    // The fake trusts the caller's keypair like the real server does.
    return Device(
      id: 'dev_123',
      name: name,
      platform: platform,
      wgPublicKey: wgPublicKey,
      lastSeenDay: null,
      createdAt: 1700000000,
    );
  }

  @override
  Future<void> deleteDevice(String id) async {}

  @override
  Future<List<VpnNode>> listNodes() async => const [
        VpnNode(
          id: 'node_fra',
          region: 'EU Central',
          countryCode: 'de',
          city: 'Frankfurt',
          endpoint: '203.0.113.10:51820',
          status: NodeStatus.active,
          sortOrder: 0,
        ),
        VpnNode(
          id: 'node_nyc',
          region: 'US East',
          countryCode: 'us',
          city: 'New York',
          endpoint: '203.0.113.20:51820',
          status: NodeStatus.active,
          sortOrder: 1,
        ),
      ];

  @override
  Future<WireGuardPeerConfig> connect(
      {required String deviceId, String? nodeId}) async {
    connectCalls++;
    if (failConnectOnce) {
      failConnectOnce = false;
      throw const ApiException(
          code: 'no_entitlement', message: 'No active subscription.');
    }
    return WireGuardPeerConfig.fromJson(_peerJson(nodeId ?? 'node_fra'));
  }

  @override
  Future<void> disconnectPeer(String deviceId) async {}

  @override
  Future<SubscriptionView> getSubscription() async => SubscriptionView(
        subscription: const Subscription(
          id: 'sub_123',
          planId: 'plan_monthly',
          planSlug: 'plan_monthly',
          status: SubscriptionStatus.active,
          currentPeriodEnd: 9999999999,
          graceUntil: null,
          provider: BillingProvider.stripe,
        ),
        entitlement: Entitlement(
          userId: 'user_123',
          planSlug: 'plan_monthly',
          status: SubscriptionStatus.active,
          deviceLimit: 5,
          canConnect: canConnect,
          currentPeriodEnd: 9999999999,
          graceUntil: null,
        ),
      );

  @override
  Future<Uri> createCheckout(
          {required String planId, required String provider}) async =>
      Uri.parse('https://checkout.example/$planId');

  @override
  Future<Uri> createPortal() async =>
      Uri.parse('https://portal.example/');

  @override
  Future<List<Announcement>> listAnnouncements() async => const [];

  @override
  Future<Map<String, dynamic>> exportData() async => {'user': 'user_123'};

  @override
  Future<void> deleteAccount() async => store.clearAll();
}
