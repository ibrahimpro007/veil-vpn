# VeilVPN — macOS build notes

The Flutter macOS runner is generated (`flutter create --platforms=macos .`);
the VPN pieces below are hand-written and must be wired in Xcode.

## 1. PacketTunnel target

1. Open `macos/Runner.xcworkspace` in Xcode.
2. File → New → Target → **Network Extension** → name it `PacketTunnel`,
   bundle id `com.veil.vpn.packet-tunnel` (must match
   `providerBundleIdentifier` in `VeilVpnPlugin.swift`).
3. Replace the generated `PacketTunnelProvider.swift` with
   `macos/Runner/PacketTunnel/PacketTunnelProvider.swift`.
4. Set the target's entitlements file to
   `macos/Runner/PacketTunnel/PacketTunnel.entitlements`.
5. In the extension target's Info.plist, ensure the extension dictionary:
   ```xml
   <key>NSExtension</key>
   <dict>
     <key>NSExtensionPointIdentifier</key>
     <string>com.apple.networkextension.packet-tunnel</string>
     <key>NSExtensionPrincipalClass</key>
     <string>PacketTunnelProvider</string>
   </dict>
   ```
6. Embed the extension in the Runner target (Build Phases → Embed App
   Extensions, "Copy only when installing" **off**).

## 2. WireGuardKit (Swift Package Manager)

WireGuardKit is **not** vendored (it is a separate open-source project).
In Xcode: File → Add Package Dependencies → enter
`https://git.zx2c4.com/wireguard-apple`, add the **WireGuardKit** product
to the **PacketTunnel** target only. (`import WireGuardKit` in
`PacketTunnelProvider.swift` resolves once linked.)

## 3. App entitlements

Set the Runner target's entitlements to
`macos/Runner/Runner.entitlements` (App Sandbox + NetworkExtension
`packet-tunnel-provider` so `NEVPNManager` works).

## 4. Plugin registration

`macos/Runner/MainFlutterWindow.swift` (generated) registers plugins
automatically; `VeilVpnPlugin.register(with:)` is picked up because the
class is a `FlutterPlugin` in the Runner target. Verify that
`GeneratedPluginRegistrant` includes it after building.

## 5. Signing

Direct-download builds are signed with a **Developer ID Application**
certificate (no App Store). The NetworkExtension entitlement requires the
Mac to approve the system extension on first connect — the OS prompts
automatically via `NEVPNManager`.

## Known limitations (honest)

- WireGuardKit exposes no public per-tunnel byte counters, so macOS shows
  session duration; rx/tx read 0.
- The kill switch uses `NEOnDemandRuleConnect` (auto-reconnect on network
  change), not a packet-level firewall block. The Settings screen says this.
- Launch-at-login writes `~/Library/LaunchAgents/com.veil.vpn.plist`
  pointing at the app bundle — it assumes the app lives in /Applications.
