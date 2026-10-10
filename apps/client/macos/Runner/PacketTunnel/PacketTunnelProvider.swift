//
//  PacketTunnelProvider.swift
//  VeilVPN Packet Tunnel (NetworkExtension)
//
//  WireGuard tunnel built on WireGuardKit (from wireguard-apple, added via
//  Swift Package Manager — see macos/README.md). The wg-quick config string
//  arrives via NETunnelProviderProtocol.providerConfiguration["config"].
//
//  DNS/IPv6 policy: the config always carries the node resolver as DNS and
//  AllowedIPs 0.0.0.0/0 + ::/0 (assembled in Dart), so IPv6 is routed into
//  the tunnel and dropped server-side instead of leaking.
//
//  NOTE on stats: WireGuardKit does not publish per-tunnel byte counters via
//  public API, so the "stats" app-message replies with the session start time;
//  the Flutter UI shows session duration on macOS (byte counters read 0).
//

import NetworkExtension
import WireGuardKit

class PacketTunnelProvider: NEPacketTunnelProvider {

    private var adapter: WireGuardAdapter?
    private var connectDate: Date?

    override func startTunnel(
        options: [String: NSObject]?,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let proto = protocolConfiguration as? NETunnelProviderProtocol,
              let configString = proto.providerConfiguration?["config"] as? String,
              !configString.isEmpty else {
            completionHandler(NSError(
                domain: NEVPNErrorDomain,
                code: NEVPNError.configurationInvalid.rawValue
            ))
            return
        }

        let tunnelConfiguration: TunnelConfiguration
        do {
            tunnelConfiguration = try TunnelConfiguration(
                fromWgQuickConfig: configString,
                called: "VeilVPN"
            )
        } catch {
            completionHandler(error)
            return
        }

        do {
            adapter = try WireGuardAdapter(with: self) { level, message in
                wgLog(level: level, message: message)
            }
        } catch {
            completionHandler(error)
            return
        }

        adapter?.start(tunnelConfiguration: tunnelConfiguration) { [weak self] error in
            if error == nil {
                self?.connectDate = Date()
            }
            completionHandler(error)
        }
    }

    override func stopTunnel(
        with reason: NEProviderStopReason,
        completionHandler: @escaping () -> Void
    ) {
        adapter?.stop { _ in
            completionHandler()
        }
        connectDate = nil
    }

    override func cancelTunnelWithError(_ error: Error?) {
        adapter = nil
        connectDate = nil
        super.cancelTunnelWithError(error)
    }

    /// App messages from the Flutter side. Currently: "stats".
    override func handleAppMessage(
        _ messageData: Data,
        completionHandler: ((Data?) -> Void)?
    ) {
        guard let message = String(data: messageData, encoding: .utf8) else {
            completionHandler?(nil)
            return
        }
        if message == "stats" {
            let payload: [String: Any] = [
                "rxBytes": 0,
                "txBytes": 0,
                "latestHandshakeAt": 0,
                // WireGuardKit exposes no byte counters publicly; the app
                // falls back to session duration on macOS.
                "connectedSince": Int(connectDate?.timeIntervalSince1970 ?? 0),
            ]
            completionHandler?(try? JSONSerialization.data(withJSONObject: payload))
        } else {
            completionHandler?(nil)
        }
    }
}

private func wgLog(level: WireGuardLogLevel, message: String) {
    switch level {
    case .verbose:
        NSLog("[wg] \(message)")
    case .error:
        NSLog("[wg:error] \(message)")
    @unknown default:
        NSLog("[wg] \(message)")
    }
}
