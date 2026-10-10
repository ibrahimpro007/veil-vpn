//
//  VeilVpnPlugin.swift
//  Bridges MethodChannel "veil_vpn/tunnel" -> NEVPNManager,
//  EventChannel "veil_vpn/tunnel_status" <- NEVPNStatusDidChange,
//  and MethodChannel "veil_vpn/system" for OS settings.
//

import Cocoa
import FlutterMacOS
import NetworkExtension

// MARK: - Tunnel channel

public class VeilVpnPlugin: NSObject, FlutterPlugin, FlutterStreamHandler {
    private var eventSink: FlutterEventSink?
    private var statusObserver: NSObjectProtocol?

    public static func register(with registrar: FlutterPluginRegistrar) {
        let instance = VeilVpnPlugin()

        let tunnel = FlutterMethodChannel(
            name: "veil_vpn/tunnel",
            binaryMessenger: registrar.messenger
        )
        registrar.addMethodCallDelegate(instance, channel: tunnel)

        let events = FlutterEventChannel(
            name: "veil_vpn/tunnel_status",
            binaryMessenger: registrar.messenger
        )
        events.setStreamHandler(instance)

        let system = FlutterMethodChannel(
            name: "veil_vpn/system",
            binaryMessenger: registrar.messenger
        )
        registrar.addMethodCallDelegate(VeilSystemPlugin(), channel: system)
    }

    public func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "startTunnel":
            guard let args = call.arguments as? [String: Any],
                  let config = args["config"] as? String, !config.isEmpty else {
                result(FlutterError(code: "bad_config",
                                    message: "Missing WireGuard config.",
                                    details: nil))
                return
            }
            startTunnel(config: config, result: result)

        case "stopTunnel":
            NEVPNManager.shared().connection.stopVPNTunnel()
            result(nil)

        case "getStats":
            sendProviderMessage("stats", result: result)

        default:
            result(FlutterMethodNotImplemented)
        }
    }

    // MARK: EventChannel

    public func onListen(withArguments arguments: Any?,
                         eventSink events: @escaping FlutterEventSink) -> FlutterError? {
        eventSink = events
        // Push the current status immediately, then on every change.
        pushStatus(NEVPNManager.shared().connection.status)
        statusObserver = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            self?.pushStatus(NEVPNManager.shared().connection.status)
        }
        return nil
    }

    public func onCancel(withArguments arguments: Any?) -> FlutterError? {
        if let observer = statusObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        statusObserver = nil
        eventSink = nil
        return nil
    }

    private func pushStatus(_ status: NEVPNStatus) {
        let (state, message): (String, String?) = {
            switch status {
            case .connected:     return ("connected", nil)
            case .connecting:     return ("connecting", nil)
            case .disconnecting:  return ("disconnecting", nil)
            case .reasserting:    return ("connecting", nil)
            case .disconnected:   return ("disconnected", nil)
            case .invalid:        return ("disconnected", nil)
            @unknown default:     return ("disconnected", nil)
            }
        }()
        eventSink?(["state": state, "message": message as Any])
    }

    // MARK: Tunnel control

    private func startTunnel(config: String, result: @escaping FlutterResult) {
        let manager = NEVPNManager.shared()
        manager.loadFromPreferences { loadError in
            if let loadError = loadError {
                result(FlutterError(code: "load_failed",
                                    message: loadError.localizedDescription,
                                    details: nil))
                return
            }
            let proto = NETunnelProviderProtocol()
            // Must match the PacketTunnel target's bundle identifier
            // (see macos/README.md).
            proto.providerBundleIdentifier = "com.veil.vpn.packet-tunnel"
            proto.serverAddress = "VeilVPN"
            proto.providerConfiguration = ["config": config]
            proto.disconnectOnSleep = false

            manager.protocolConfiguration = proto
            manager.localizedDescription = "VeilVPN"
            manager.isEnabled = true
            manager.saveToPreferences { saveError in
                if let saveError = saveError {
                    result(FlutterError(code: "save_failed",
                                        message: saveError.localizedDescription,
                                        details: nil))
                    return
                }
                // First save triggers the system VPN approval prompt; the
                // user must approve once in System Settings.
                manager.loadFromPreferences { _ in
                    do {
                        try manager.connection.startVPNTunnel()
                        result(nil)
                    } catch {
                        result(FlutterError(code: "start_failed",
                                            message: error.localizedDescription,
                                            details: nil))
                    }
                }
            }
        }
    }

    private func sendProviderMessage(_ message: String,
                                     result: @escaping FlutterResult) {
        let manager = NEVPNManager.shared()
        guard manager.connection.status == .connected,
              let session = manager.connection as? NETunnelProviderSession else {
            result(["rxBytes": 0, "txBytes": 0, "latestHandshakeAt": 0])
            return
        }
        do {
            try session.sendProviderMessage(
                message.data(using: .utf8)!
            ) { response in
                guard let response = response,
                      let json = try? JSONSerialization.jsonObject(with: response)
                        as? [String: Any] else {
                    result(["rxBytes": 0, "txBytes": 0, "latestHandshakeAt": 0])
                    return
                }
                result(json)
            }
        } catch {
            result(["rxBytes": 0, "txBytes": 0, "latestHandshakeAt": 0])
        }
    }
}

// MARK: - System channel (kill switch, launch at login)

/// Handles MethodChannel "veil_vpn/system".
class VeilSystemPlugin: NSObject, FlutterPlugin {
    static func register(with registrar: FlutterPluginRegistrar) {}

    func handle(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
        switch call.method {
        case "setKillSwitch":
            let enabled = (call.arguments as? [String: Any])?["enabled"] as? Bool ?? false
            setKillSwitch(enabled: enabled, result: result)
        case "setLaunchAtLogin":
            let enabled = (call.arguments as? [String: Any])?["enabled"] as? Bool ?? false
            setLaunchAtLogin(enabled: enabled, result: result)
        default:
            result(FlutterMethodNotImplemented)
        }
    }

    /// Kill switch via on-demand rules: when enabled, any network change
    /// brings the tunnel back up automatically. This is NOT a packet-level
    /// firewall block — the Settings screen says so. (A true block would
    /// need a transparent proxy / socket filter; out of scope for $0.)
    private func setKillSwitch(enabled: Bool, result: @escaping FlutterResult) {
        let manager = NEVPNManager.shared()
        manager.loadFromPreferences { _ in
            if enabled {
                let rule = NEOnDemandRuleConnect()
                rule.interfaceTypeMatch = .any
                manager.onDemandRules = [rule]
                manager.isOnDemandEnabled = true
            } else {
                manager.onDemandRules = []
                manager.isOnDemandEnabled = false
            }
            manager.saveToPreferences { error in
                if let error = error {
                    result(FlutterError(code: "save_failed",
                                        message: error.localizedDescription,
                                        details: nil))
                } else {
                    result(nil)
                }
            }
        }
    }

    /// Launch at login via a user LaunchAgent plist. Works when the app
    /// lives in /Applications (the normal direct-download install location).
    private func setLaunchAtLogin(enabled: Bool, result: @escaping FlutterResult) {
        let fm = FileManager.default
        guard let home = ProcessInfo.processInfo.environment["HOME"],
              let exe = Bundle.main.executablePath else {
            result(FlutterError(code: "unavailable",
                                message: "Cannot determine app location.",
                                details: nil))
            return
        }
        let agents = (home as NSString).appendingPathComponent("Library/LaunchAgents")
        let plistPath = (agents as NSString).appendingPathComponent("com.veil.vpn.plist")
        do {
            if enabled {
                try fm.createDirectory(atPath: agents,
                                       withIntermediateDirectories: true)
                let plist: [String: Any] = [
                    "Label": "com.veil.vpn",
                    "ProgramArguments": [exe, "--minimized"],
                    "RunAtLoad": true,
                ]
                let data = try PropertyListSerialization.data(
                    fromPropertyList: plist,
                    format: .xml,
                    options: 0
                )
                try data.write(to: URL(fileURLWithPath: plistPath))
            } else if fm.fileExists(atPath: plistPath) {
                try fm.removeItem(atPath: plistPath)
            }
            result(nil)
        } catch {
            result(FlutterError(code: "plist_failed",
                                message: error.localizedDescription,
                                details: nil))
        }
    }
}
