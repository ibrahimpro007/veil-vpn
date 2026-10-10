-- VeilVPN D1 seed: plans only.
-- Nodes are intentionally NOT seeded: vpn_nodes stays empty until real
-- node agents register (Phase 4+). The first admin user is created via the
-- apps/api admin-bootstrap script with an interactive password + TOTP setup
-- (never seeded from checked-in SQL — secrets must not live in the repo).
--
-- Apply: wrangler d1 execute veil-vpn-db --file=infra/d1/seed.sql

PRAGMA foreign_keys = ON;

-- plan_free_trial: 7-day $0 trial, device_limit 1
INSERT INTO plans (id, name, slug, price_cents, currency, interval, device_limit, provider_product_refs, active, created_at, updated_at)
VALUES
  ('plan_free_trial', 'Veil Trial', 'free-trial', 0, 'USD', 'month', 1, '{}', 1, strftime('%s','now'), strftime('%s','now'))
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name, price_cents = excluded.price_cents,
  device_limit = excluded.device_limit, updated_at = excluded.updated_at;

-- plan_monthly: Veil Monthly, $4.99/mo = 499 cents
INSERT INTO plans (id, name, slug, price_cents, currency, interval, device_limit, provider_product_refs, active, created_at, updated_at)
VALUES
  ('plan_monthly', 'Veil Monthly', 'monthly', 499, 'USD', 'month', 5, '{}', 1, strftime('%s','now'), strftime('%s','now'))
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name, price_cents = excluded.price_cents,
  device_limit = excluded.device_limit, updated_at = excluded.updated_at;

-- plan_yearly: Veil Yearly, $49.99/yr = 4999 cents
INSERT INTO plans (id, name, slug, price_cents, currency, interval, device_limit, provider_product_refs, active, created_at, updated_at)
VALUES
  ('plan_yearly', 'Veil Yearly', 'yearly', 4999, 'USD', 'year', 5, '{}', 1, strftime('%s','now'), strftime('%s','now'))
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name, price_cents = excluded.price_cents,
  device_limit = excluded.device_limit, updated_at = excluded.updated_at;
