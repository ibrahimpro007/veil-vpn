/// In-app update checker for direct-download builds.
///
/// Queries `https://api.github.com/repos/<GITHUB_REPO>/releases/latest`
/// and compares the release tag against the installed version. Store
/// flavors (`play`, `macstore`) skip this — updates come from the store.
library;

import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../core/config.dart';

class UpdateInfo {
  final bool available;
  final String currentVersion;
  final String latestVersion;
  final String url;
  final String notes;

  const UpdateInfo({
    required this.available,
    required this.currentVersion,
    required this.latestVersion,
    required this.url,
    required this.notes,
  });
}

final updateProvider =
    StateNotifierProvider<UpdateNotifier, AsyncValue<UpdateInfo?>>(
  (ref) => UpdateNotifier(),
);

class UpdateNotifier extends StateNotifier<AsyncValue<UpdateInfo?>> {
  UpdateNotifier() : super(const AsyncValue.data(null));

  /// Returns true if [a] is a newer semver than [b]. Tags may be prefixed
  /// with `v` (e.g. `v0.2.0`); build metadata is ignored.
  static bool isNewer(String a, String b) =>
      _compareVersions(_normalize(a), _normalize(b)) > 0;

  static String _normalize(String v) {
    var s = v.trim();
    if (s.startsWith('v') || s.startsWith('V')) s = s.substring(1);
    return s.split('+').first;
  }

  static int _compareVersions(String a, String b) {
    final pa = a.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    final pb = b.split('.').map((e) => int.tryParse(e) ?? 0).toList();
    for (var i = 0; i < 3; i++) {
      final x = i < pa.length ? pa[i] : 0;
      final y = i < pb.length ? pb[i] : 0;
      if (x != y) return x.compareTo(y);
    }
    return 0;
  }

  Future<void> check() async {
    if (!AppConfig.isDirect) {
      // Store builds update through the store, not GitHub Releases.
      state = const AsyncValue.data(null);
      return;
    }
    state = const AsyncValue.loading();
    try {
      final info = await PackageInfo.fromPlatform();
      final dio = Dio(BaseOptions(
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 10),
      ));
      final res = await dio.get(
        'https://api.github.com/repos/${AppConfig.githubRepo}/releases/latest',
        options: Options(headers: {'Accept': 'application/vnd.github+json'}),
      );
      final json = (res.data as Map<String, dynamic>?) ?? const {};
      final tag = (json['tag_name'] as String? ?? '').trim();
      final url = (json['html_url'] as String? ?? '').trim();
      final notes = (json['body'] as String? ?? '').trim();
      if (tag.isEmpty) {
        state = const AsyncValue.data(null);
        return;
      }
      state = AsyncValue.data(UpdateInfo(
        available: isNewer(tag, info.version),
        currentVersion: info.version,
        latestVersion: tag,
        url: url,
        notes: notes.length > 500 ? '${notes.substring(0, 500)}…' : notes,
      ));
    } catch (e, st) {
      // Update checks are advisory — never break the app.
      state = AsyncValue.error(e, st);
    }
  }

  void dismiss() => state = const AsyncValue.data(null);
}

/// Visible for tests.
String updateNotesPreview(String notes) =>
    notes.length > 500 ? '${notes.substring(0, 500)}…' : notes;
