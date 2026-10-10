/// Typed API models. Field names and shapes match
/// `packages/shared/src/openapi.yaml` and `packages/shared/src/types.ts`
/// exactly. All timestamps are Unix epoch seconds.
library;

int? _asInt(dynamic v) => v is int ? v : (v is num ? v.toInt() : null);
String _asString(dynamic v, [String fallback = '']) =>
    v is String ? v : fallback;
bool _asBool(dynamic v, [bool fallback = false]) =>
    v is bool ? v : fallback;
List<String> _asStringList(dynamic v) =>
    v is List ? v.whereType<String>().toList() : const [];

/* ---------------- auth ---------------- */

class AuthTokens {
  final String accessToken;
  final String refreshToken;
  final int expiresIn;

  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.expiresIn,
  });

  factory AuthTokens.fromJson(Map<String, dynamic> json) => AuthTokens(
        accessToken: _asString(json['accessToken']),
        refreshToken: _asString(json['refreshToken']),
        expiresIn: _asInt(json['expiresIn']) ?? 0,
      );

  Map<String, dynamic> toJson() => {
        'accessToken': accessToken,
        'refreshToken': refreshToken,
        'expiresIn': expiresIn,
      };
}

/* ---------------- user ---------------- */

enum UserStatus { active, suspended, banned, deleted, unknown }

UserStatus parseUserStatus(String? s) => UserStatus.values.firstWhere(
      (e) => e.name == s,
      orElse: () => UserStatus.unknown,
    );

class UserProfile {
  final String id;
  final String email;
  final bool emailVerified;
  final UserStatus status;
  final int createdAt;

  const UserProfile({
    required this.id,
    required this.email,
    required this.emailVerified,
    required this.status,
    required this.createdAt,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: _asString(json['id']),
        email: _asString(json['email']),
        emailVerified: _asBool(json['emailVerified']),
        status: parseUserStatus(json['status'] as String?),
        createdAt: _asInt(json['createdAt']) ?? 0,
      );
}

/* ---------------- device ---------------- */

class Device {
  final String id;
  final String name;
  final String platform; // windows|android|macos|linux|ios
  final String wgPublicKey;
  final int? lastSeenDay; // day granularity only — privacy invariant
  final int createdAt;

  const Device({
    required this.id,
    required this.name,
    required this.platform,
    required this.wgPublicKey,
    required this.lastSeenDay,
    required this.createdAt,
  });

  factory Device.fromJson(Map<String, dynamic> json) => Device(
        id: _asString(json['id']),
        name: _asString(json['name']),
        platform: _asString(json['platform']),
        wgPublicKey: _asString(json['wgPublicKey']),
        lastSeenDay: _asInt(json['lastSeenDay']),
        createdAt: _asInt(json['createdAt']) ?? 0,
      );
}

/* ---------------- nodes ---------------- */

enum NodeStatus { active, draining, disabled, unknown }

NodeStatus parseNodeStatus(String? s) => NodeStatus.values.firstWhere(
      (e) => e.name == s,
      orElse: () => NodeStatus.unknown,
    );

class VpnNode {
  final String id;
  final String region;
  final String countryCode;
  final String city;
  final String endpoint; // 'host:port'
  final NodeStatus status;
  final int sortOrder;

  /// Client-measured ICMP round-trip to the endpoint host, in ms.
  /// Null when not measured yet or unreachable. Never comes from the API
  /// (the API intentionally exposes no load/latency figures).
  final int? latencyMs;

  const VpnNode({
    required this.id,
    required this.region,
    required this.countryCode,
    required this.city,
    required this.endpoint,
    required this.status,
    required this.sortOrder,
    this.latencyMs,
  });

  factory VpnNode.fromJson(Map<String, dynamic> json) => VpnNode(
        id: _asString(json['id']),
        region: _asString(json['region']),
        countryCode: _asString(json['countryCode']),
        city: _asString(json['city']),
        endpoint: _asString(json['endpoint']),
        status: parseNodeStatus(json['status'] as String?),
        sortOrder: _asInt(json['sortOrder']) ?? 0,
      );

  VpnNode copyWith({int? latencyMs}) => VpnNode(
        id: id,
        region: region,
        countryCode: countryCode,
        city: city,
        endpoint: endpoint,
        status: status,
        sortOrder: sortOrder,
        latencyMs: latencyMs ?? this.latencyMs,
      );

  String get host => endpoint.split(':').first;
  int get port {
    final parts = endpoint.split(':');
    if (parts.length > 1) {
      return int.tryParse(parts.last) ?? 51820;
    }
    return 51820;
  }

  String get displayName => '$city, $region';
}

/* ---------------- WireGuard peer config ---------------- */

class PeerNodeInfo {
  final String id;
  final String countryCode;
  final String city;
  final String region;

  const PeerNodeInfo({
    required this.id,
    required this.countryCode,
    required this.city,
    required this.region,
  });

  factory PeerNodeInfo.fromJson(Map<String, dynamic> json) => PeerNodeInfo(
        id: _asString(json['id']),
        countryCode: _asString(json['countryCode']),
        city: _asString(json['city']),
        region: _asString(json['region']),
      );
}

class WireGuardPeerConfig {
  final String address;
  final String subnet;
  final String serverPublicKey;
  final String endpoint;
  final String dns;
  final List<String> allowedIps;
  final PeerNodeInfo node;
  final int expiresAt;

  const WireGuardPeerConfig({
    required this.address,
    required this.subnet,
    required this.serverPublicKey,
    required this.endpoint,
    required this.dns,
    required this.allowedIps,
    required this.node,
    required this.expiresAt,
  });

  factory WireGuardPeerConfig.fromJson(Map<String, dynamic> json) =>
      WireGuardPeerConfig(
        address: _asString(json['address']),
        subnet: _asString(json['subnet']),
        serverPublicKey: _asString(json['serverPublicKey']),
        endpoint: _asString(json['endpoint']),
        dns: _asString(json['dns']),
        allowedIps: _asStringList(json['allowedIps']),
        node: PeerNodeInfo.fromJson(
          (json['node'] as Map<String, dynamic>?) ?? const {},
        ),
        expiresAt: _asInt(json['expiresAt']) ?? 0,
      );
}

/* ---------------- subscription / entitlement ---------------- */

enum SubscriptionStatus {
  trialing,
  active,
  pastDue,
  canceled,
  expired,
  unknown,
}

SubscriptionStatus parseSubscriptionStatus(String? s) {
  switch (s) {
    case 'trialing':
      return SubscriptionStatus.trialing;
    case 'active':
      return SubscriptionStatus.active;
    case 'past_due':
      return SubscriptionStatus.pastDue;
    case 'canceled':
      return SubscriptionStatus.canceled;
    case 'expired':
      return SubscriptionStatus.expired;
    default:
      return SubscriptionStatus.unknown;
  }
}

enum BillingProvider { stripe, lemonsqueezy, play, storekit, comp, unknown }

BillingProvider parseBillingProvider(String? s) => BillingProvider.values
    .firstWhere((e) => e.name == s, orElse: () => BillingProvider.unknown);

class Entitlement {
  final String userId;
  final String planSlug;
  final SubscriptionStatus status;
  final int deviceLimit;
  final bool canConnect;
  final int? currentPeriodEnd;
  final int? graceUntil;

  const Entitlement({
    required this.userId,
    required this.planSlug,
    required this.status,
    required this.deviceLimit,
    required this.canConnect,
    required this.currentPeriodEnd,
    required this.graceUntil,
  });

  factory Entitlement.fromJson(Map<String, dynamic> json) => Entitlement(
        userId: _asString(json['userId']),
        planSlug: _asString(json['planSlug']),
        status: parseSubscriptionStatus(json['status'] as String?),
        deviceLimit: _asInt(json['deviceLimit']) ?? 0,
        canConnect: _asBool(json['canConnect']),
        currentPeriodEnd: _asInt(json['currentPeriodEnd']),
        graceUntil: _asInt(json['graceUntil']),
      );
}

class Subscription {
  final String id;
  final String planId;
  final String planSlug;
  final SubscriptionStatus status;
  final int? currentPeriodEnd;
  final int? graceUntil;
  final BillingProvider provider;

  const Subscription({
    required this.id,
    required this.planId,
    required this.planSlug,
    required this.status,
    required this.currentPeriodEnd,
    required this.graceUntil,
    required this.provider,
  });

  factory Subscription.fromJson(Map<String, dynamic> json) => Subscription(
        id: _asString(json['id']),
        planId: _asString(json['planId']),
        planSlug: _asString(json['planSlug']),
        status: parseSubscriptionStatus(json['status'] as String?),
        currentPeriodEnd: _asInt(json['currentPeriodEnd']),
        graceUntil: _asInt(json['graceUntil']),
        provider: parseBillingProvider(json['provider'] as String?),
      );
}

class SubscriptionView {
  final Subscription? subscription;
  final Entitlement? entitlement;

  const SubscriptionView({this.subscription, this.entitlement});

  factory SubscriptionView.fromJson(Map<String, dynamic> json) =>
      SubscriptionView(
        subscription: json['subscription'] is Map<String, dynamic>
            ? Subscription.fromJson(json['subscription'] as Map<String, dynamic>)
            : null,
        entitlement: json['entitlement'] is Map<String, dynamic>
            ? Entitlement.fromJson(json['entitlement'] as Map<String, dynamic>)
            : null,
      );
}

/* ---------------- announcements ---------------- */

class Announcement {
  final String id;
  final String title;
  final String body;
  final int? startsAt;
  final int? endsAt;
  final int createdAt;

  const Announcement({
    required this.id,
    required this.title,
    required this.body,
    required this.startsAt,
    required this.endsAt,
    required this.createdAt,
  });

  factory Announcement.fromJson(Map<String, dynamic> json) => Announcement(
        id: _asString(json['id']),
        title: _asString(json['title']),
        body: _asString(json['body']),
        startsAt: _asInt(json['startsAt']),
        endsAt: _asInt(json['endsAt']),
        createdAt: _asInt(json['createdAt']) ?? 0,
      );
}
