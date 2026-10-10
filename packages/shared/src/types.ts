/**
 * Shared enums and API shapes for VeilVPN.
 * These types are contracts: the API, admin panel, node agent, and
 * client apps must all follow them exactly.
 */

import type { Platform } from "./schemas.js";

/* ---------------- Enums ---------------- */

/** Subscription lifecycle states. */
export enum SubscriptionStatus {
  Trialing = "trialing",
  Active = "active",
  PastDue = "past_due",
  Canceled = "canceled",
  Expired = "expired",
}

/** VPN node lifecycle states. */
export enum NodeStatus {
  Active = "active",
  Draining = "draining",
  Disabled = "disabled",
}

/** End-user account states. */
export enum UserStatus {
  Active = "active",
  Suspended = "suspended",
  Banned = "banned",
  Deleted = "deleted",
}

/** Admin roles (least privilege). */
export enum UserRole {
  Owner = "owner",
  Support = "support",
  ReadOnly = "read-only",
}

/** Admin account states. */
export enum AdminStatus {
  Active = "active",
  Suspended = "suspended",
}

/** Billing providers. */
export enum BillingProvider {
  Stripe = "stripe",
  LemonSqueezy = "lemonsqueezy",
  Play = "play",
  StoreKit = "storekit",
  Comp = "comp",
}

/** Billing intervals. */
export enum PlanInterval {
  Month = "month",
  Year = "year",
}

/** Email token purposes. */
export enum EmailTokenPurpose {
  Verify = "verify",
  Reset = "reset",
}

/* ---------------- API envelope ---------------- */

export interface ApiErrorBody {
  error: {
    /** Stable machine-readable code, e.g. "rate_limited", "validation_error". */
    code: string;
    /** Human-readable message (no stack traces, no internal details). */
    message: string;
  };
  /** Echoed back for support correlation. */
  requestId: string;
}

export interface Paginated<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
}

/* ---------------- WireGuard ---------------- */

/**
 * WireGuard peer config handed to the client app after a successful
 * POST /v1/connect. The client writes it into a WireGuard tunnel config.
 * Private keys are generated and stored ONLY on the client device —
 * the server only ever sees the public key.
 */
export interface WireGuardPeerConfig {
  /** The client's assigned VPN IPv4 address, e.g. "10.7.3.42". */
  address: string;
  /** VPN subnet the client joins, e.g. "10.7.0.0/24". */
  subnet: string;
  /** Server-side WireGuard public key of the assigned node. */
  serverPublicKey: string;
  /** Node endpoint as "host:port". */
  endpoint: string;
  /** DNS resolver inside the VPN (no-logs resolver). */
  dns: string;
  /** Allowed IPs for the peer, always ["0.0.0.0/0"]. */
  allowedIps: string[];
  /** Public info for UI: country code, city, region. No load numbers. */
  node: {
    id: string;
    countryCode: string;
    city: string;
    region: string;
  };
  /** Unix epoch seconds when this config expires (peer is removed). */
  expiresAt: number;
}

/* ---------------- Entitlement ---------------- */

/**
 * Entitlement resolved from the user's subscription.
 * Drives connect permission and device limits.
 */
export interface Entitlement {
  userId: string;
  planSlug: string;
  status: SubscriptionStatus;
  /** Max concurrent devices allowed by the plan. */
  deviceLimit: number;
  /** Whether the user may establish VPN sessions right now. */
  canConnect: boolean;
  /** Unix epoch seconds; null when not in a trial or grace period. */
  currentPeriodEnd: number | null;
  /** Unix epoch seconds; null when not past due. */
  graceUntil: number | null;
}

/* ---------------- Session / auth ---------------- */

export interface AuthTokens {
  /** Short-lived JWT (access). */
  accessToken: string;
  /** Rotating refresh token (opaque). */
  refreshToken: string;
  /** Seconds until access token expiry. */
  expiresIn: number;
}

/* ---------------- Domain views (API responses) ---------------- */

export interface UserProfile {
  id: string;
  email: string;
  emailVerified: boolean;
  status: UserStatus;
  createdAt: number;
}

export interface Device {
  id: string;
  name: string;
  platform: Platform;
  /** Server stores only the public key. */
  wgPublicKey: string;
  /** Day-granularity only (no precise timestamps — privacy). */
  lastSeenDay: number | null;
  createdAt: number;
}

export interface VpnNodePublic {
  id: string;
  region: string;
  countryCode: string;
  city: string;
  /** "host:port" */
  endpoint: string;
  status: NodeStatus;
  /** Sort hint for clients; load figures are NEVER exposed. */
  sortOrder: number;
}

/** Admin view of a node: internal detail (capacity etc.), never public. */
export interface VpnNodeAdmin extends VpnNodePublic {
  wgPublicKey: string;
  capacity: number;
  ipPoolCidr: string;
  dnsIp: string;
  createdAt: number;
  updatedAt: number;
}

export interface Subscription {
  id: string;
  planId: string;
  planSlug: string;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
  graceUntil: number | null;
  provider: BillingProvider;
}

export interface Plan {
  id: string;
  name: string;
  slug: string;
  priceCents: number;
  currency: string;
  interval: PlanInterval;
  deviceLimit: number;
  active: boolean;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  startsAt: number | null;
  endsAt: number | null;
  createdAt: number;
}

export interface AuditLogEntry {
  id: number;
  prevHash: string;
  hash: string;
  actorAdminId: string | null;
  actorUserId: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  detail: string | null;
  createdAt: number;
}

/**
 * Webhook-derived payment event. Only the sha256 hex of the raw payload
 * is stored — the raw payload is never kept (no-logs invariant).
 */
export interface PaymentEvent {
  id: string;
  provider: BillingProvider;
  /** Provider's own payment/order identifier (used for refund deep links). */
  providerEventId: string;
  type: string;
  /** sha256 hex of raw webhook payload. */
  payloadHash: string;
  amountCents: number | null;
  currency: string | null;
  processedAt: number | null;
  createdAt: number;
}
