# VeilVPN — Phase 1 Notes (contracts for all later phases)

Phase 1 delivered: repo scaffold + shared contracts + D1 schema + migrations +
seed/backup scripts + `.env.example` files. Every later phase MUST follow the
contracts below exactly. Deviations require updating `packages/shared` AND this
document together.

## App name / identity

- `APP_NAME = VeilVPN`
- Workspace root: `~/workspace/veil-vpn`, pnpm + Turborepo, Node 20 (`.nvmrc`).
- Workspaces: `apps/api`, `apps/admin`, `apps/client`, `apps/node-agent`,
  `apps/site`, `packages/shared`.
- Budget: $0 — free tiers only, no paid store deployments. Client downloads go
  through GitHub Releases (site links there).

## Source of truth

- `packages/shared/src/schemas.ts` — Zod schemas (request validation). Export
  inferred types; import them in `apps/api`, `apps/admin`, `apps/node-agent`.
  Never hand-roll a duplicate schema.
- `packages/shared/src/types.ts` — enums (`SubscriptionStatus`, `NodeStatus`,
  `UserRole`, `UserStatus`, `AdminStatus`, `BillingProvider`, `PlanInterval`,
  `EmailTokenPurpose`, `Platform`) and shapes (`ApiError` =
  `{error:{code,message}, requestId}`, `WireGuardPeerConfig`, `Entitlement`,
  `AuthTokens`, `UserProfile`, `Device`, `VpnNodePublic`, `Subscription`,
  `Plan`, `Announcement`, `PaymentEvent`, `AuditLogEntry`, `Paginated`).
- `packages/shared/src/openapi.yaml` — OpenAPI 3.1 spec. It is the route
  contract; keep it in sync with the implemented Worker routes.

## Database (D1, SQLite)

- Migration: `infra/d1/migrations/0001_init.sql`. Table names (exact):
  `users`, `email_tokens`, `refresh_tokens`, `devices`, `plans`,
  `subscriptions`, `payment_events`, `vpn_nodes`, `peers`, `admin_users`,
  `audit_logs`, `abuse_flags`, `announcements`.
- All timestamps: INTEGER Unix epoch seconds. Primary keys: TEXT (opaque ids),
  except `audit_logs.id` which is `INTEGER AUTOINCREMENT`.
- Foreign keys with `ON DELETE CASCADE` (peers die with devices; refresh/email
  tokens die with users). `payment_events.user_id` is `ON DELETE SET NULL`.
- CHECK constraints pin every enum; the partial unique index
  `idx_subscriptions_live_user` enforces **one live subscription per user**
  (statuses trialing/active/past_due).
- Privacy invariants (no-logs):
  - `devices.last_seen_coarse`: **day granularity only** (YYYYMMDD integer).
    Never store precise connection timestamps.
  - `payment_events.raw_hash`: sha256 hex of the raw webhook payload.
    The raw payload is **never stored**.
  - `audit_logs.detail`: ids and action metadata only, no PII.
  - `GET /v1/nodes` exposes only region/country/city/endpoint/status/sort —
    never load, capacity, or peer counts.
- Seed (`infra/d1/seed.sql`, idempotent via upserts):
  - `plan_free_trial` — "Veil Trial", 0¢, USD, month interval, device_limit 1.
  - `plan_monthly` — "Veil Monthly", 499¢ ($4.99), USD, month, device_limit 5.
  - `plan_yearly` — "Veil Yearly", 4999¢ ($49.99), USD, year, device_limit 5.
- `vpn_nodes` seeds **empty** — nodes appear only when real node agents
  register. The first admin user is created by an interactive bootstrap script
  in Phase 2 (never from checked-in SQL).

## Auth model

- User auth: Argon2id password hashes; short-lived EdDSA (Ed25519) access
  JWTs + rotating opaque refresh tokens with family-based reuse detection
  (`refresh_tokens.family_id`; reuse revokes the whole family).
- Password minimum: **12 characters** (enforced in Zod + OpenAPI).
- Admin auth: separate `admin_users` table, password + TOTP (secret stored
  AES-GCM encrypted with `ADMIN_TOTP_ENC_KEY`), roles
  `owner | support | read-only`, session JWT on `/admin/*` (`adminSession`
  security scheme).

## Node-agent HMAC scheme (control plane)

Signer and verifier must implement exactly:

1. `bodyHash = sha256_hex(raw request body)` (empty string → hash of `""`).
2. `message = "<timestamp>.<method>.<path>.<bodyHash>"`
   - `<timestamp>`: Unix epoch seconds, ASCII.
   - `<method>`: uppercase, e.g. `POST`.
   - `<path>`: path + query string as sent, e.g. `/v1/node/sync?x=1`.
3. `signature = HMAC_SHA256_hex(key = NODE_AGENT_HMAC_SECRET, message)`.
4. Headers: `X-Veil-Signature: <signature>`, `X-Veil-Timestamp: <timestamp>`.
5. Verifier rejects when `|now - timestamp| > 300` seconds (5-min skew),
   using constant-time signature comparison.

- Shared secret env name: `NODE_AGENT_HMAC_SECRET` (Worker) /
  `VEIL_HMAC_SECRET` (node agent). Same value, provisioned at node install.

## API routes (v1) — full list

Auth: `POST /v1/auth/register`, `POST /v1/auth/login`,
`POST /v1/auth/refresh`, `POST /v1/auth/logout`,
`POST /v1/auth/verify-email`, `POST /v1/auth/forgot-password`,
`POST /v1/auth/reset-password`.
User: `GET /v1/me`, `PATCH /v1/me`.
Devices: `GET /v1/devices`, `POST /v1/devices`, `DELETE /v1/devices/:id`.
Nodes/connect: `GET /v1/nodes` (public), `POST /v1/connect`,
`POST /v1/disconnect` (optional).
Billing: `GET /v1/subscription`, `POST /v1/billing/checkout`,
`POST /v1/billing/portal`.
Webhooks: `POST /v1/webhooks/stripe`, `POST /v1/webhooks/lemonsqueezy`,
`POST /v1/webhooks/play`, `POST /v1/webhooks/storekit`
(all signature-verified, idempotent via `payment_events.provider_event_id`).
Misc: `GET /v1/announcements`, `GET /v1/gdpr/export`,
`DELETE /v1/gdpr/account`.
Admin (`adminSession`): `GET /admin/users?search=`,
`POST /admin/users/:id/suspend`, `POST /admin/users/:id/ban`,
`POST /admin/devices/:id/revoke`, `POST /admin/grants`,
`GET /admin/subscriptions`, `GET /admin/payment-events`, `GET /admin/nodes`,
`PATCH /admin/nodes/:id`, `POST /admin/announcements`,
`GET /admin/audit-logs`, `GET /admin/audit-logs/verify`,
`GET /admin/export/users.csv`.
Also: `GET /v1/health` (used by smoke test; add to spec in Phase 2).

## Rate limiting

- KV-backed (`RATE_LIMIT` binding). Sensitive endpoints (register, login,
  refresh, password flows) get tight per-IP buckets.
- `429` responses carry `Retry-After` + `X-Request-Id` headers and the
  standard `ApiError` body (`code: "rate_limited"`).

## Correlation

- Every response includes `X-Request-Id`; every error body includes
  `requestId`. Generate with `crypto.randomUUID()` per request.

## Infra files (Phase 1)

- `infra/wrangler.toml` — Worker bindings (`DB` D1 `veil-vpn-db`,
  `RATE_LIMIT` KV), public vars, crons `*/15 * * * *` (peer/token sweep) and
  `0 * * * *` (subscription lifecycle). Secrets via `wrangler secret put`
  only — placeholders here, never values.
- `infra/vercel.json` — monorepo template; `apps/admin/vercel.json` and
  `apps/site/vercel.json` are the per-project deploy configs (separate
  Vercel projects, root directory = the app dir).
- `infra/scripts/backup-d1.sh` — timestamped `wrangler d1 export`,
  14-export retention. `infra/scripts/smoke-test.sh` — curl checks for
  `/v1/health`, register 201/409 + 429 rate-limit, `/v1/nodes` shape and
  no load-data leak.
- `infra/cloud-init/node-bootstrap.sh` — thin idempotent VM prep wrapper;
  hands off to the Phase 4 node-agent installer via `NODE_AGENT_INSTALL_URL`.

## Env var names (exact — do not rename without updating all phases)

API: `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, `JWT_EDDSA_PRIVATE_KEY`,
`JWT_EDDSA_PUBLIC_KEY`, `APP_URL`, `API_PUBLIC_URL`, `ADMIN_URL`,
`RESEND_API_KEY`, `EMAIL_FROM`, `STRIPE_SECRET_KEY`,
`STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `LEMONSQUEEZY_API_KEY`,
`LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_STORE_ID`,
`NODE_AGENT_HMAC_SECRET`, `ADMIN_TOTP_ENC_KEY`,
`GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`, `APPLE_APPSTORE_ISSUER_ID`,
`APPLE_APPSTORE_KEY_ID`, `APPLE_APPSTORE_PRIVATE_KEY`.
Admin: `NEXT_PUBLIC_API_BASE_URL`, `ADMIN_SESSION_SECRET`
(`ADMIN_TOTP_ENC_KEY` must match the API's value).
Node agent: `VEIL_API_BASE`, `VEIL_NODE_ID`, `VEIL_HMAC_SECRET`
(same value as `NODE_AGENT_HMAC_SECRET`), `WG_INTERFACE`,
`WG_LISTEN_PORT`, `WG_PRIVATE_KEY`, `IP_POOL_CIDR`, `DNS_IP`,
`PEER_SYNC_INTERVAL_SECONDS`.
Client: build-time `--dart-define=API_BASE_URL=https://api.veil.example`
(no secrets in the app).

## Phase 2 onward (not in scope here)

- Phase 2: full Worker implementation (Hono, all `/v1/*` routes, crons,
  webhook handlers, admin bootstrap CLI).
- Phase 3: D1 hardening (backup cron, restore drill).
- Phase 4: Go node agent + WireGuard sync + installer.
- Phase 5: Next.js admin console (all `/admin/*` routes UI).
- Phase 6: marketing/download site.
- Phase 7: Flutter client (Windows/Android/macOS first).
