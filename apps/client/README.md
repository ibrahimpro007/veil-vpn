# VeilVPN client (Flutter)

Material 3 + Riverpod app for **Windows, Android, macOS** (iOS/Linux later).
Direct-download builds via GitHub Releases — `$0` budget, no store accounts.

## Quick start

```sh
cd apps/client
flutter pub get

# Run (dev API)
flutter run \
  --dart-define=API_BASE_URL=https://api.veil.example \
  --dart-define=FLAVOR=direct \
  --dart-define=GITHUB_REPO=myorg/veil-vpn
```

`flutter analyze` should be clean; `flutter test` runs the widget suite
(`test/widget_test.dart`, manual fakes — no codegen).

## Build flavors

| Flag                            | Meaning                                                                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `--dart-define=FLAVOR=direct`   | **Shipped flavor.** Web checkout (Stripe/LemonSqueezy), update check via GitHub Releases.                                             |
| `--dart-define=FLAVOR=play`     | Store scaffolding compiles (`in_app_purchase`), but billing is **inactive** without Play Console products + RTDN webhook server-side. |
| `--dart-define=FLAVOR=macstore` | Same caveat for StoreKit / App Store Server Notifications.                                                                            |

`API_BASE_URL` is the API origin **without** `/v1` (paths already include it,
per `packages/shared/src/openapi.yaml`).

## Platform notes

### Android

- `android/` is complete: `VpnService` + official `com.wireguard.android:tunnel`
  (GoBackend, userspace — no root) behind MethodChannel `veil_vpn/tunnel`.
- Split tunneling = per-app `ExcludedApplications` → `addDisallowedApplication`.
- Kill switch: the app deep-links to system VPN settings for Always-on +
  "Block connections without VPN" (non-device-owner apps can't toggle it).
- Signing the direct APK: add your keystore to
  `android/app/build.gradle` (`signingConfigs.release`) and build
  `flutter build apk --release`. Publish the APK to GitHub Releases.

### Windows

- Tunnel control needs admin → `windows/helper/veil_helper.dart`, compiled
  with `dart compile exe` (`windows/build_helper.ps1`), installed once via
  `tool/install_helper.ps1` **as Administrator** (installs official WireGuard,
  the helper exe, a random auth token, and the `VeilVPNHelper` scheduled
  task running as SYSTEM).
- Kill switch = Windows Firewall rules (allow WG endpoint + DHCP, block all
  other outbound). Applied on connect, removed on clean disconnect, kept on
  unexpected drops.
- Launch at login = HKCU `...\Run` value (no elevation needed).

### macOS

- `macos/Runner/VeilVpnPlugin.swift` drives `NEVPNManager`;
  `macos/Runner/PacketTunnel/PacketTunnelProvider.swift` is a NetworkExtension
  built on **WireGuardKit** (SPM, `https://git.zx2c4.com/wireguard-apple` —
  not vendored). See `macos/README.md` for the exact Xcode steps.
- Kill switch = `NEOnDemandRuleConnect` (auto-reconnect on network change),
  **not** a packet-level block — the Settings screen says this.
- Byte counters aren't exposed by WireGuardKit; macOS shows session duration.

## API contract

Every `/v1/*` route, request/response shape, and error envelope matches
`packages/shared/src/openapi.yaml` exactly:

- Bearer JWT attached automatically; 401 triggers one guarded refresh
  (`POST /v1/auth/refresh`) and a single retry.
- `X-Request-Id` on every request; `{error:{code,message}, requestId}`
  mapped to typed `ApiException`s.
- Passwords: min 12 chars (client + server enforced).
- Keypairs are generated **on device** (`cryptography` X25519); only the
  44-char base64 public key is uploaded (`POST /v1/devices`).

## Honest limitations

- Tunnel adapters need **real-device testing** (no emulator/simulator can
  fully validate VpnService / NetworkExtension / firewall rules).
- Kotlin/Swift were written carefully against the libraries' public APIs
  (verified against wireguard-android sources) but have not been compiled
  here — build on the target OS before shipping.
- Android latency = ICMP ping to the node host (not WireGuard handshake RTT).
- macOS stats show session duration only (WireGuardKit limitation).
- Windows kill switch blocks LAN traffic too while engaged (documented).
