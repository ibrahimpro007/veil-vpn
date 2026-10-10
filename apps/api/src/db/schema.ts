/**
 * Drizzle ORM schema for the VeilVPN D1 database.
 * Mirrors infra/d1/migrations/0001_init.sql exactly, plus:
 *  - 0002_additions.sql: users.name (profile display name)
 *  - 0003_additions.sql: subscriptions.provider_customer_id (Stripe customer
 *    id, needed for the Customer Portal without a second API lookup)
 *
 * All timestamps are INTEGER Unix epoch seconds. Privacy invariants from
 * PHASE1_NOTES.md apply: devices.last_seen_coarse is day-granularity only,
 * payment_events stores only the sha256 of the raw webhook payload.
 */
import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    /** Optional display name, set via PATCH /v1/me. */
    name: text("name"),
    emailVerifiedAt: integer("email_verified_at"),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_users_email").on(t.email),
    index("idx_users_status").on(t.status),
    check(
      "users_status_check",
      sql`${t.status} IN ('active','suspended','banned','deleted')`,
    ),
  ],
);

export const emailTokens = sqliteTable(
  "email_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex of the token — the raw token is only ever sent by email. */
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_email_tokens_user").on(t.userId),
    check(
      "email_tokens_purpose_check",
      sql`${t.purpose} IN ('verify','reset')`,
    ),
  ],
);

export const refreshTokens = sqliteTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** sha256 hex of the opaque refresh token. */
    tokenHash: text("token_hash").notNull().unique(),
    familyId: text("family_id").notNull(),
    deviceId: text("device_id").references(() => devices.id, {
      onDelete: "set null",
    }),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    /** Set when a revoked token is presented again (reuse detection). */
    reusedAt: integer("reused_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_refresh_tokens_user").on(t.userId),
    index("idx_refresh_tokens_family").on(t.familyId),
  ],
);

export const devices = sqliteTable(
  "devices",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    platform: text("platform").notNull(),
    /** Server stores the public key only; the private key never leaves the device. */
    wgPublicKey: text("wg_public_key").notNull().unique(),
    /** Day granularity ONLY (YYYYMMDD integer). No precise timestamps — privacy. */
    lastSeenCoarse: integer("last_seen_coarse"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_devices_user").on(t.userId),
    check(
      "devices_platform_check",
      sql`${t.platform} IN ('windows','android','macos','linux','ios')`,
    ),
  ],
);

export const plans = sqliteTable("plans", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  priceCents: integer("price_cents").notNull(),
  currency: text("currency").notNull().default("USD"),
  interval: text("interval").notNull(),
  deviceLimit: integer("device_limit").notNull().default(5),
  /** JSON: {"stripe": "price_...", "lemonsqueezy": "variant_...", ...} */
  providerProductRefs: text("provider_product_refs").notNull().default("{}"),
  active: integer("active").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const subscriptions = sqliteTable(
  "subscriptions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id),
    status: text("status").notNull(),
    currentPeriodEnd: integer("current_period_end"),
    provider: text("provider").notNull(),
    /** Provider's subscription id (Stripe sub_..., LemonSqueezy id, ...). */
    providerRef: text("provider_ref").unique(),
    /** Provider's customer id (Stripe cus_...) — needed for the billing portal. */
    providerCustomerId: text("provider_customer_id"),
    graceUntil: integer("grace_until"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_subscriptions_user").on(t.userId),
    index("idx_subscriptions_status_end").on(t.status, t.currentPeriodEnd),
    check(
      "subscriptions_status_check",
      sql`${t.status} IN ('trialing','active','past_due','canceled','expired')`,
    ),
    check(
      "subscriptions_provider_check",
      sql`${t.provider} IN ('stripe','lemonsqueezy','play','storekit','comp')`,
    ),
    // One live subscription per user. (D1/SQLite partial unique index.)
    uniqueIndex("idx_subscriptions_live_user")
      .on(t.userId)
      .where(sql`${t.status} IN ('trialing','active','past_due')`),
  ],
);

export const paymentEvents = sqliteTable(
  "payment_events",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id").notNull().unique(),
    type: text("type").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    subscriptionId: text("subscription_id").references(() => subscriptions.id, {
      onDelete: "set null",
    }),
    amountCents: integer("amount_cents"),
    currency: text("currency"),
    /** sha256 hex of the raw webhook payload. The payload itself is never stored. */
    rawHash: text("raw_hash").notNull(),
    processedAt: integer("processed_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_payment_events_provider_event").on(t.providerEventId),
    index("idx_payment_events_user").on(t.userId),
    check(
      "payment_events_provider_check",
      sql`${t.provider} IN ('stripe','lemonsqueezy','play','storekit','comp')`,
    ),
  ],
);

export const vpnNodes = sqliteTable(
  "vpn_nodes",
  {
    id: text("id").primaryKey(),
    region: text("region").notNull(),
    countryCode: text("country_code").notNull(),
    city: text("city").notNull(),
    /** "host:port" */
    endpoint: text("endpoint").notNull(),
    wgPublicKey: text("wg_public_key").notNull(),
    capacity: integer("capacity").notNull().default(100),
    status: text("status").notNull().default("disabled"),
    ipPoolCidr: text("ip_pool_cidr").notNull(),
    dnsIp: text("dns_ip").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_vpn_nodes_status").on(t.status),
    check(
      "vpn_nodes_status_check",
      sql`${t.status} IN ('active','draining','disabled')`,
    ),
  ],
);

export const peers = sqliteTable(
  "peers",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .unique()
      .references(() => devices.id, { onDelete: "cascade" }),
    nodeId: text("node_id")
      .notNull()
      .references(() => vpnNodes.id, { onDelete: "cascade" }),
    assignedIp: text("assigned_ip").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_peers_node").on(t.nodeId),
    uniqueIndex("idx_peers_node_ip").on(t.nodeId, t.assignedIp),
  ],
);

export const adminUsers = sqliteTable(
  "admin_users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    role: text("role").notNull(),
    /** TOTP secret, AES-256-GCM encrypted with ADMIN_TOTP_ENC_KEY. */
    totpSecretEncrypted: text("totp_secret_encrypted").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("idx_admin_users_email").on(t.email),
    check(
      "admin_users_role_check",
      sql`${t.role} IN ('owner','support','read-only')`,
    ),
    check(
      "admin_users_status_check",
      sql`${t.status} IN ('active','suspended')`,
    ),
  ],
);

export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    prevHash: text("prev_hash").notNull(),
    hash: text("hash").notNull(),
    actorAdminId: text("actor_admin_id").references(() => adminUsers.id, {
      onDelete: "set null",
    }),
    actorUserId: text("actor_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    /** Ids and action metadata only — never PII. */
    detail: text("detail"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("idx_audit_logs_action").on(t.action),
    index("idx_audit_logs_entity").on(t.entity, t.entityId),
  ],
);

export const abuseFlags = sqliteTable(
  "abuse_flags",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    reason: text("reason"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("idx_abuse_flags_user").on(t.userId)],
);

export const announcements = sqliteTable(
  "announcements",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    startsAt: integer("starts_at"),
    endsAt: integer("ends_at"),
    createdAt: integer("created_at").notNull(),
    createdByAdminId: text("created_by_admin_id").references(
      () => adminUsers.id,
      {
        onDelete: "set null",
      },
    ),
  },
  (t) => [index("idx_announcements_window").on(t.startsAt, t.endsAt)],
);
