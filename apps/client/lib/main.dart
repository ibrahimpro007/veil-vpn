/// VeilVPN client entry point.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:tray_manager/tray_manager.dart' as tray_legacy
    show trayManager, Menu, MenuItem, TrayListener;
import 'package:window_manager/window_manager.dart';

import 'app.dart';
import 'core/platform_info.dart';

Future<void> main(List<String> args) async {
  WidgetsFlutterBinding.ensureInitialized();

  if (isDesktop) {
    await _initDesktop(args);
  }

  runApp(const ProviderScope(child: VeilApp()));
}

/// Desktop-only: window setup + system tray (connect/disconnect/quit).
Future<void> _initDesktop(List<String> args) async {
  try {
    await windowManager.ensureInitialized();
    const options = WindowOptions(
      size: Size(420, 760),
      minimumSize: Size(360, 600),
      center: true,
      title: 'VeilVPN',
    );
    await windowManager.waitUntilReadyToShow(options, () async {
      // Launched at login with --minimized: start hidden in the tray.
      if (!args.contains('--minimized')) {
        await windowManager.show();
        await windowManager.focus();
      }
    });
    await _initTray();
  } catch (e) {
    debugPrint('[veil] desktop init failed (non-fatal): $e');
  }
}

Future<void> _initTray() async {
  // tray_manager 0.5.x legacy API (stable). Everything is best-effort:
  // a missing tray must never break the app.
  try {
    await tray_legacy.trayManager.setIcon(
      Platform.isWindows ? 'assets/icons/tray.ico' : 'assets/icons/tray.png',
    );
    await tray_legacy.trayManager.setToolTip('VeilVPN — disconnected');
    await tray_legacy.trayManager.setContextMenu(
      tray_legacy.Menu(items: [
        tray_legacy.MenuItem(key: 'show', label: 'Show VeilVPN'),
        tray_legacy.MenuItem.separator(),
        tray_legacy.MenuItem(key: 'quit', label: 'Quit'),
      ]),
    );
    tray_legacy.trayManager.addListener(_TrayHandler());
  } catch (e) {
    debugPrint('[veil] tray init failed (non-fatal): $e');
  }
}

class _TrayHandler with tray_legacy.TrayListener {
  @override
  void onTrayIconMouseDown() {
    tray_legacy.trayManager.popUpContextMenu();
  }

  @override
  void onTrayMenuItemClick(tray_legacy.MenuItem menuItem) {
    switch (menuItem.key) {
      case 'show':
        windowManager.show();
        windowManager.focus();
      case 'quit':
        // A full disconnect-before-quit is handled by the app lifecycle;
        // here we just close the window.
        windowManager.destroy();
    }
  }
}
