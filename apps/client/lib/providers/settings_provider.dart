/// User settings, persisted in SharedPreferences (non-secret).
/// Secrets stay in [SecureStore].
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

class AppSettings {
  final bool killSwitch;
  final bool autoReconnect;
  final bool launchAtLogin;
  final bool connectOnLaunch;

  /// Android split tunneling: package names excluded from the VPN.
  final List<String> excludedApps;

  /// Desktop split tunneling: custom AllowedIPs CIDR list. Empty = full
  /// tunnel (0.0.0.0/0 + ::/0).
  final List<String> allowedIpsOverride;

  final String? selectedNodeId;
  final Set<String> dismissedAnnouncements;

  const AppSettings({
    this.killSwitch = false,
    this.autoReconnect = true,
    this.launchAtLogin = false,
    this.connectOnLaunch = false,
    this.excludedApps = const [],
    this.allowedIpsOverride = const [],
    this.selectedNodeId,
    this.dismissedAnnouncements = const {},
  });

  AppSettings copyWith({
    bool? killSwitch,
    bool? autoReconnect,
    bool? launchAtLogin,
    bool? connectOnLaunch,
    List<String>? excludedApps,
    List<String>? allowedIpsOverride,
    String? selectedNodeId,
    Set<String>? dismissedAnnouncements,
  }) =>
      AppSettings(
        killSwitch: killSwitch ?? this.killSwitch,
        autoReconnect: autoReconnect ?? this.autoReconnect,
        launchAtLogin: launchAtLogin ?? this.launchAtLogin,
        connectOnLaunch: connectOnLaunch ?? this.connectOnLaunch,
        excludedApps: excludedApps ?? this.excludedApps,
        allowedIpsOverride: allowedIpsOverride ?? this.allowedIpsOverride,
        selectedNodeId: selectedNodeId ?? this.selectedNodeId,
        dismissedAnnouncements:
            dismissedAnnouncements ?? this.dismissedAnnouncements,
      );
}

final settingsProvider =
    StateNotifierProvider<SettingsNotifier, AppSettings>(
  (ref) => SettingsNotifier(),
);

class SettingsNotifier extends StateNotifier<AppSettings> {
  static const _kKillSwitch = 'veil.kill_switch';
  static const _kAutoReconnect = 'veil.auto_reconnect';
  static const _kLaunchAtLogin = 'veil.launch_at_login';
  static const _kConnectOnLaunch = 'veil.connect_on_launch';
  static const _kExcludedApps = 'veil.excluded_apps';
  static const _kAllowedIps = 'veil.allowed_ips';
  static const _kSelectedNode = 'veil.selected_node';
  static const _kDismissed = 'veil.dismissed_announcements';

  SharedPreferences? _prefs;

  SettingsNotifier() : super(const AppSettings()) {
    _load();
  }

  Future<void> _load() async {
    _prefs = await SharedPreferences.getInstance();
    final p = _prefs!;
    state = AppSettings(
      killSwitch: p.getBool(_kKillSwitch) ?? false,
      autoReconnect: p.getBool(_kAutoReconnect) ?? true,
      launchAtLogin: p.getBool(_kLaunchAtLogin) ?? false,
      connectOnLaunch: p.getBool(_kConnectOnLaunch) ?? false,
      excludedApps: p.getStringList(_kExcludedApps) ?? const [],
      allowedIpsOverride: p.getStringList(_kAllowedIps) ?? const [],
      selectedNodeId: p.getString(_kSelectedNode),
      dismissedAnnouncements:
          (p.getStringList(_kDismissed) ?? const []).toSet(),
    );
  }

  Future<void> _save() async {
    final p = _prefs ?? await SharedPreferences.getInstance();
    _prefs = p;
    await p.setBool(_kKillSwitch, state.killSwitch);
    await p.setBool(_kAutoReconnect, state.autoReconnect);
    await p.setBool(_kLaunchAtLogin, state.launchAtLogin);
    await p.setBool(_kConnectOnLaunch, state.connectOnLaunch);
    await p.setStringList(_kExcludedApps, state.excludedApps);
    await p.setStringList(_kAllowedIps, state.allowedIpsOverride);
    if (state.selectedNodeId != null) {
      await p.setString(_kSelectedNode, state.selectedNodeId!);
    } else {
      await p.remove(_kSelectedNode);
    }
    await p.setStringList(_kDismissed, state.dismissedAnnouncements.toList());
  }

  Future<void> setKillSwitch(bool v) async {
    state = state.copyWith(killSwitch: v);
    await _save();
  }

  Future<void> setAutoReconnect(bool v) async {
    state = state.copyWith(autoReconnect: v);
    await _save();
  }

  Future<void> setLaunchAtLogin(bool v) async {
    state = state.copyWith(launchAtLogin: v);
    await _save();
  }

  Future<void> setConnectOnLaunch(bool v) async {
    state = state.copyWith(connectOnLaunch: v);
    await _save();
  }

  Future<void> setExcludedApps(List<String> apps) async {
    state = state.copyWith(excludedApps: apps);
    await _save();
  }

  Future<void> setAllowedIpsOverride(List<String> cidrs) async {
    state = state.copyWith(allowedIpsOverride: cidrs);
    await _save();
  }

  Future<void> selectNode(String? id) async {
    state = state.copyWith(selectedNodeId: id);
    // copyWith can't null out; handle explicitly.
    if (id == null) {
      state = AppSettings(
        killSwitch: state.killSwitch,
        autoReconnect: state.autoReconnect,
        launchAtLogin: state.launchAtLogin,
        connectOnLaunch: state.connectOnLaunch,
        excludedApps: state.excludedApps,
        allowedIpsOverride: state.allowedIpsOverride,
        dismissedAnnouncements: state.dismissedAnnouncements,
      );
    }
    await _save();
  }

  Future<void> dismissAnnouncement(String id) async {
    state = state.copyWith(
      dismissedAnnouncements: {...state.dismissedAnnouncements, id},
    );
    await _save();
  }
}
