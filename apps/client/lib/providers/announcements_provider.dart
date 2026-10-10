/// Public announcements (`GET /v1/announcements`), shown as a dismissible
/// banner on the home screen.
library;

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/models.dart';
import 'providers.dart';
import 'settings_provider.dart';

final announcementsProvider = FutureProvider<List<Announcement>>((ref) async {
  final api = ref.watch(veilApiClientProvider);
  final dismissed = ref.watch(settingsProvider).dismissedAnnouncements;
  final all = await api.listAnnouncements();
  final now = DateTime.now().millisecondsSinceEpoch ~/ 1000;
  return all.where((a) {
    if (dismissed.contains(a.id)) return false;
    if (a.startsAt != null && now < a.startsAt!) return false;
    if (a.endsAt != null && now > a.endsAt!) return false;
    return true;
  }).toList();
});
