# VeilVPN — Phases 2+3 Notes (apps/api)

The full Cloudflare Worker is implemented in `apps/api` (Hono + Drizzle ORM on
D1, KV for rate limiting). All 36 routes from PHASE1_NOTES.md plus the
additions below are live. `npx tsc --noEmit` passes; the Vitest suite
(57 tests) passes against the real migration SQL on an in-memory SQLite
D1 stub.

## Decisions

- **PBKDF2-SHA256/600k instead of Argon2id** (documented in
  `src/util/crypto.ts`): Workers has no native Argon2 and Argon2id WASM
  exceeds Worker CPU/memory limits on the login path. PBKDF2 at 600k
  iterations meets OWASP's current minimum, runs in WebCrypto, and the
  stored format (`$pbkdf2-sha256$<iter>$<salt>$<hash>`) is self-describing
  for a future migration.
- **EdDSA (Ed25519) JWTs via WebCrypto**, `kid: ed25519-1`, PEM-encoded
  PKCS#8/SPKI keys from env. 15-min access / 30-day refresh, rotating
  refresh families with reuse detection (reuse revokes the whole family).
- **Register is anti-enumeration**: always 201 with the same shape, whether
  or not the email exists. Verification email is queued only for new
  accounts. (This replaces the 409 in the original spec — openapi updated.)
- **Trial on verification**: `POST /v1/auth/verify-email` creates a 7-day
  `trialing` subscription (`provider='comp'`, plan `free-trial`) when the
  user has no live subscription, so verified users can connect immediately.
- **Email verification + password reset** via Resend REST (`fetch`, no SDK),
  best-effort (a mail outage never breaks the request). Tokens are 32 random
  bytes, sha256-hashed at rest, single-use, 30-min expiry.
- **Login lockout**: per-IP + per-account KV buckets, exponential backoff
  (5 fails → 15-min lock, doubling per further block of 5).
- **Connect**: entitlement computed server-side from `subscriptions` only;
  least-loaded active node by peers/capacity (draining nodes take no new
  peers); IP allocation skips network/broadcast **and the node's DNS IP**;
  D1 has no interactive transactions, so allocation is
  read-used-IPs → first-free → INSERT with a UNIQUE-constraint retry loop;
  the node-agent call is HMAC-signed per the PHASE1 scheme and retried once —
  on failure the peer row is rolled back and the client gets a 502.
- **Webhooks**: signature-verified (Stripe `t,v1` + 5-min skew, LemonSqueezy
  `X-Signature`, Play via server-side purchase verification, StoreKit via
  x5c-chain + JWS verification). Idempotency via
  `payment_events.provider_event_id` UNIQUE with INSERT-first
  `ON CONFLICT DO NOTHING`. Only the sha256 of the raw payload is stored.
- **Play/StoreKit** are fully implemented but activate only for store
  flavors; direct-download builds (the only builds shipped on the $0
  budget) use web checkout. Attribution: Play `obfuscatedExternalAccountId`
  / StoreKit `appAccountToken` = VeilVPN user id (set by the client at
  purchase time); the purchase token alone is never trusted.
- **LemonSqueezy has no portal-session API** → `POST /v1/billing/portal`
  returns 404 `portal_unsupported` for it (documented in code).
- **GDPR**: export carries hashes only for payment events and no precise
  timestamps on devices; delete is password-confirmed, removes peers from
  node agents first, hard-deletes the user (CASCADE), and writes the audit
  entry _before_ the delete so it survives via `ON DELETE SET NULL`.
- **Admin**: separate `admin_users` table, password + TOTP (RFC 6238 in
  WebCrypto, secret AES-256-GCM encrypted with `ADMIN_TOTP_ENC_KEY`), 12h
  session JWT, RBAC owner > support > read-only. Every mutating admin action
  appends a hash-chained audit row; pure reads don't (so `verify` stays
  meaningful). First admin is created with `scripts/bootstrap-admin.mjs`
  (prints SQL + otpauth URL), never from seeded SQL.
- **Crons**: every 15 min → revoke peers of lapsed subscriptions
  (best-effort node DELETE + row delete); hourly → purge expired/used
  email tokens + revoked/expired refresh tokens (>30d), and the subscription
  lifecycle sweep (trial expiry, grace exhaustion, active-with-lapsed-period
  → past_due safety net). Webhooks remain the primary source of truth.

## Test strategy (`apps/api/test/`)

- `helpers.ts`: `D1Stub` — a D1Database-compatible stub backed by
  **node:sqlite**, applying the **real** `infra/d1/migrations/*.sql` in
  order, plus plan seeds; `KVStub` — in-memory KV; requests go through the
  real Worker (`api.fetch`) with the real middleware stack.
- Pure unit tests: entitlement state machine, IP allocator (incl. /30
  exhaustion), RFC 6238 TOTP vectors, audit hash chain (incl. tamper
  detection).
- Integration tests: auth (register→verify→login→refresh rotation→reuse
  detection revokes family; lockout; password reset kills sessions),
  webhooks (Stripe + LemonSqueezy signature verification, idempotency,
  bad-signature rejection), connect/disconnect (IP allocation, HMAC
  signature recomputed in-test, idempotent reconnect, 402 without
  entitlement, device limits, key uniqueness), cron (lapsed-peer revocation,
  token purge), admin (TOTP login, RBAC matrix, suspend/unsuspend/ban,
  grants, audit verify, node PATCH, announcements, CSV export), GDPR
  (export shape, password-confirmed delete + cascade).
- Node-agent and Stripe REST calls are intercepted by stubbing
  `globalThis.fetch` in the tests that need them.

## Deviations from Phase 1 contracts (all documented here + in code)

1. `POST /v1/auth/register` returns **201 always** (anti-enumeration)
   instead of 409 on duplicate email — openapi.yaml updated.
2. New migrations (0001 untouched):
   - `0002_profile_name.sql`: `users.name` — `PATCH /v1/me` manages the
     display name (name only). `packages/shared` `updateProfileSchema` and
     openapi updated to match.
   - `0003_provider_customer.sql`: `subscriptions.provider_customer_id` —
     Stripe customer id for the Customer Portal without an extra lookup.
3. New routes (openapi.yaml updated): `GET /v1/health`,
   `POST /admin/auth/login`, `POST /admin/auth/totp-verify`,
   `POST /admin/users/:id/unsuspend`, `GET /admin/announcements`,
   `DELETE /admin/announcements/:id`; `status` filter added to
   `GET /admin/users`.
4. `GET /admin/audit-logs/verify` returns `{valid, checked, brokenAtId}`
   per openapi (the task shorthand said `ok/brokenAt`).
5. `infra/wrangler.toml`: `main` corrected to `../apps/api/src/index.ts`
   (it pointed at a nonexistent `infra/src/index.ts`).
6. Admin reads (list/search) don't write audit rows — only mutations,
   logins, and exports do.

## What's mocked / not live yet

- Outbound mail (Resend) and provider REST calls are real `fetch` code but
  need real secrets; tests stub them.
- No node agents exist yet (Phase 4) — `vpn_nodes` seeds empty per Phase 1;
  connect/disconnect degrade cleanly (502 / best-effort + reconcile).
- `wrangler secret put` must still provision all secrets from
  `apps/api/.env.example` before deploy; `.dev.vars` for local dev.
