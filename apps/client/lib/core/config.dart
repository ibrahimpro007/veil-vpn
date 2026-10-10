/// Build-time configuration for the VeilVPN client.
///
/// Everything here comes from `--dart-define` flags so no secrets or
/// environment-specific values are ever baked in from files:
/// ```sh
/// flutter build apk \
///   --dart-define=API_BASE_URL=https://api.veil.example \
///   --dart-define=FLAVOR=direct \
///   --dart-define=GITHUB_REPO=myorg/veil-vpn
/// ```
///
/// Flavors:
/// * `direct`   — direct-download builds (GitHub Releases). Fully implemented.
///                This is the only flavor shipped under the $0 budget.
/// * `play`     — Google Play build. Store-billing code paths compile but are
///                INACTIVE unless Play Console products + RTDN webhook are set up.
/// * `macstore` — Mac App Store build. Same caveat for StoreKit / App Store
///                Server Notifications.
class AppConfig {
  AppConfig._();

  /// API origin WITHOUT the `/v1` prefix, e.g. `https://api.veil.example`.
  /// Paths in [VeilApiClient] already include `/v1/...` per openapi.yaml.
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://api.veil.example',
  );

  /// One of `direct`, `play`, `macstore`.
  static const String flavor = String.fromEnvironment(
    'FLAVOR',
    defaultValue: 'direct',
  );

  /// `owner/repo` used by the in-app update checker
  /// (`https://api.github.com/repos/<GITHUB_REPO>/releases/latest`).
  static const String githubRepo = String.fromEnvironment(
    'GITHUB_REPO',
    defaultValue: 'veil/veil-vpn',
  );

  static bool get isDirect => flavor == 'direct';
  static bool get isPlay => flavor == 'play';
  static bool get isMacStore => flavor == 'macstore';

  /// True for any store-distributed build (Play or Mac App Store).
  static bool get isStoreFlavor => isPlay || isMacStore;

  /// Store billing (Play Billing / StoreKit) is only usable in store flavors
  /// AND after the corresponding store accounts/products are configured.
  static bool get storeBillingActive => false;

  /// Connectivity timeouts.
  static const Duration connectTimeout = Duration(seconds: 15);
  static const Duration receiveTimeout = Duration(seconds: 30);
}
