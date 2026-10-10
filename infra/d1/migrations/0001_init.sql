-- VeilVPN D1 migration 0001: initial schema
-- SQLite / D1. All timestamps are Unix epoch seconds (INTEGER).
-- Privacy design: no connection logs, no precise timestamps for device activity
-- (last_seen_coarse is day granularity), payment webhooks store only a SHA-256
-- of the raw payload — never the payload itself.

PRAGMA foreign_keys = ON;

-- End-user accounts
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  email_verified_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'banned', 'deleted')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_status ON users (status);

-- Email verification / password reset tokens (token_hash = sha256(token))
CREATE TABLE email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  purpose TEXT NOT NULL CHECK (purpose IN ('verify', 'reset')),
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_email_tokens_user ON email_tokens (user_id);

-- Opaque rotating refresh tokens with reuse detection via family_id
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  family_id TEXT NOT NULL,
  device_id TEXT REFERENCES devices (id) ON DELETE SET NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  reused_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family ON refresh_tokens (family_id);

-- Client devices (server stores public keys only; private keys stay on-device)
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('windows', 'android', 'macos', 'linux', 'ios')),
  wg_public_key TEXT NOT NULL UNIQUE,
  -- Day granularity ONLY (YYYYMMDD). No precise timestamps for privacy.
  last_seen_coarse INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_devices_user ON devices (user_id);

-- Plans / products
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  interval TEXT NOT NULL CHECK (interval IN ('month', 'year')),
  device_limit INTEGER NOT NULL DEFAULT 5,
  -- JSON object: {"stripe": "price_...", "lemonsqueezy": "variant_...", ...}
  provider_product_refs TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Subscriptions (one live row per user enforced by partial unique index)
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans (id),
  status TEXT NOT NULL CHECK (status IN ('trialing', 'active', 'past_due', 'canceled', 'expired')),
  current_period_end INTEGER,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'lemonsqueezy', 'play', 'storekit', 'comp')),
  provider_ref TEXT UNIQUE,
  grace_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_subscriptions_user ON subscriptions (user_id);
CREATE INDEX idx_subscriptions_status_end ON subscriptions (status, current_period_end);
CREATE UNIQUE INDEX idx_subscriptions_live_user ON subscriptions (user_id) WHERE status IN ('trialing', 'active', 'past_due');

-- Payment webhook events: idempotency + audit, raw payload NEVER stored
CREATE TABLE payment_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('stripe', 'lemonsqueezy', 'play', 'storekit', 'comp')),
  provider_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  subscription_id TEXT REFERENCES subscriptions (id) ON DELETE SET NULL,
  amount_cents INTEGER,
  currency TEXT,
  -- SHA-256 hex of the raw webhook payload. Payload itself is discarded.
  raw_hash TEXT NOT NULL,
  processed_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_payment_events_provider_event ON payment_events (provider_event_id);
CREATE INDEX idx_payment_events_user ON payment_events (user_id);

-- VPN exit nodes (managed by apps/node-agent, registered via control plane)
CREATE TABLE vpn_nodes (
  id TEXT PRIMARY KEY,
  region TEXT NOT NULL,
  country_code TEXT NOT NULL,
  city TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  wg_public_key TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 100,
  status TEXT NOT NULL DEFAULT 'disabled'
    CHECK (status IN ('active', 'draining', 'disabled')),
  ip_pool_cidr TEXT NOT NULL,
  dns_ip TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_vpn_nodes_status ON vpn_nodes (status);

-- Active WireGuard peers: one row per device, assigned IP unique per node
CREATE TABLE peers (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL UNIQUE REFERENCES devices (id) ON DELETE CASCADE,
  node_id TEXT NOT NULL REFERENCES vpn_nodes (id) ON DELETE CASCADE,
  assigned_ip TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (node_id, assigned_ip)
);
CREATE INDEX idx_peers_node ON peers (node_id);

-- Admin console accounts (TOTP-enforced; secret stored AES-GCM encrypted)
CREATE TABLE admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'support', 'read-only')),
  totp_secret_encrypted TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_admin_users_email ON admin_users (email);

-- Hash-chained audit log (append-only; verify via GET /admin/audit-logs/verify)
CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  actor_admin_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  detail TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity, entity_id);

-- Abuse / fraud flags for users
CREATE TABLE abuse_flags (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_abuse_flags_user ON abuse_flags (user_id);

-- Public announcements
CREATE TABLE announcements (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  starts_at INTEGER,
  ends_at INTEGER,
  created_at INTEGER NOT NULL,
  created_by_admin_id TEXT REFERENCES admin_users (id) ON DELETE SET NULL
);
CREATE INDEX idx_announcements_window ON announcements (starts_at, ends_at);
