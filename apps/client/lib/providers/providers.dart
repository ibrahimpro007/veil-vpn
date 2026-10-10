/// Shared Riverpod providers: storage, API client, tunnel.
///
/// Tests override [veilApiClientProvider] and [vpnTunnelProvider] with fakes.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/api_client.dart';
import '../core/secure_store.dart';
import '../tunnel/factory.dart';
import '../tunnel/vpn_tunnel.dart';

final secureStoreProvider = Provider<SecureStore>((ref) => SecureStore());

final veilApiClientProvider = Provider<VeilApiClient>(
  (ref) => DioVeilApiClient(store: ref.watch(secureStoreProvider)),
);

final vpnTunnelProvider = Provider<VpnTunnel>(
  (ref) {
    final tunnel = createPlatformTunnel();
    ref.onDispose(() => tunnel.dispose());
    return tunnel;
  },
);
