# VeilVPN — Security Policy

## 1. Threat model

**Adversaries:**

- Passive network observers (ISPs, Wi-Fi operators, backbone taps) —
  countered by WireGuard encryption on the tunnel and TLS 1.2+ everywhere
  off-tunnel.
- Active attackers on the open internet probing the API and node agents —
  countered by rate limiting, HMAC control-plane auth, and TLS.
- Malicious or compromised VPN exit node — blast radius limited: nodes hold
  no user database, only WireGuard peer keys + pool IPs; compromise response
  in §7.
- Credential-stuffing / brute-force against accounts — countered by
  PBKDF2-600k, per-IP + per-account lockout with exponential backoff, and
  12-character minimum passwords.
- Malicious users (spam, abuse, illegal activity) — acceptable-use policy,
  abuse flags, suspend/ban tooling; see [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md).
- Legal compulsion — countered structurally: activity data does not exist,
  so it cannot be disclosed (see [PRIVACY_POLICY.md](PRIVACY_POLICY.md) §4).

**Out of scope:** endpoint compromise of the user's own device; physical
seizure of infrastructure; attacks on Cloudflare / Oracle / Vercel / Stripe
themselves (we inherit their controls and monitor their status pages).

**Assets:** user credentials (hashed), WireGuard public keys, subscription
state, HMAC/control secrets, JWT signing keys, admin TOTP secrets,
TLS private keys on nodes.

**Trust boundaries:** client ↔ Worker API (JWT); Worker API ↔ node agent
(HMAC + pinned TLS); admin browser ↔ Worker `/admin/*` (password + TOTP,
12h session JWT); payment providers ↔ Worker (webhook signatures).

## 2. Cryptography choices

| Use                  | Construction                                                                                                                                      | Rationale                                                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPN tunnel           | WireGuard (X25519 key exchange, ChaCha20-Poly1305, BLAKE2s, HKDF)                                                                                 | Modern, audited, minimal attack surface; keys generated on-device, private keys never leave the device                                                                                                                                                                            |
| Password storage     | PBKDF2-SHA256, 600,000 iterations, per-user salt                                                                                                  | Workers has no native Argon2 and Argon2id WASM exceeds Worker CPU/memory limits on the login path; 600k meets OWASP's current minimum; format `$pbkdf2-sha256$<iter>$<salt>$<hash>` is self-describing for future migration (see `apps/api/src/util/crypto.ts`, PHASE23_NOTES.md) |
| Access tokens        | EdDSA (Ed25519) JWTs, `kid: ed25519-1`, 15-min TTL                                                                                                | Short-lived, asymmetric (API verifies with the public key only)                                                                                                                                                                                                                   |
| Refresh tokens       | 32 random bytes, SHA-256 hashed at rest, rotating families with reuse detection (reuse revokes the whole family)                                  | Limits the blast radius of token theft                                                                                                                                                                                                                                            |
| Admin TOTP           | RFC 6238 (TOTP), secret AES-256-GCM encrypted with `ADMIN_TOTP_ENC_KEY`                                                                           | Second factor for the admin console                                                                                                                                                                                                                                               |
| Node control auth    | HMAC-SHA256 over `<timestamp>.<method>.<path>.<sha256(body)>`, headers `X-Veil-Signature` / `X-Veil-Timestamp`, 5-min skew, constant-time compare | Replay-resistant, no bearer tokens on the wire (see PHASE1_NOTES.md §Node-agent HMAC scheme)                                                                                                                                                                                      |
| Email / reset tokens | 32 random bytes, SHA-256 hashed at rest, single-use, 30-min expiry                                                                                |                                                                                                                                                                                                                                                                                   |
| TLS                  | Node agents: self-signed certs, API pins the cert SHA-256 fingerprint; all public endpoints TLS 1.2+ via Cloudflare/Vercel                        | No CA dependency on the $0 budget                                                                                                                                                                                                                                                 |

## 3. OWASP ASVS L2 mapping (summary)

| ASVS area                   | How VeilVPN meets it                                                                                                                                                         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 Password security       | 12-char minimum (Zod + OpenAPI enforced); PBKDF2-600k; password-confirmed destructive actions (GDPR delete)                                                                  |
| 2.2 General authenticator   | Argon2id→PBKDF2 documented trade-off; TOTP second factor for admins; anti-enumeration register (always 201)                                                                  |
| 2.3 Authenticator lifecycle | Single-use hashed email/reset tokens, 30-min expiry; rotating refresh families with reuse detection                                                                          |
| 2.4 Credential storage      | Salted PBKDF2, self-describing format; secrets only via `wrangler secret put` / 0600 files, never committed (gitleaks scans in CI)                                           |
| 3.1 Session management      | 15-min access / 30-day refresh / 12h admin sessions; server-side revocation (lockout, ban, suspend, token purge)                                                             |
| 4.1 Access control          | Server-side entitlement from `subscriptions` only; RBAC owner > support > read-only on admin routes; devices scoped to owner                                                 |
| 5.1 Input validation        | Zod schemas in `packages/shared` are the single validation source; OpenAPI kept in sync                                                                                      |
| 7.1 Log handling            | No-logs architecture: no activity data exists to leak; audit logs carry ids/action metadata only, hash-chained, verifiable via `/admin/audit-logs/verify`                    |
| 7.2 Error handling          | Uniform `ApiError` `{error:{code,message}, requestId}` + `X-Request-Id`; no stack traces or secret leakage                                                                   |
| 9.1 Communications          | TLS everywhere; HMAC control plane; webhook signature verification (Stripe `t,v1` + 5-min skew, LemonSqueezy `X-Signature`, StoreKit x5c/JWS, Play server-side verification) |
| 11.1 Business logic         | Idempotent webhooks via `payment_events.provider_event_id` UNIQUE + INSERT-first; IP allocation UNIQUE-retry loop; one live subscription per user (partial unique index)     |
| 14.2 Dependency             | Weekly `security.yml`: pnpm audit, govulncheck, gitleaks, PR dependency review                                                                                               |

## 4. Abuse handling

- Reports come in via the contact details on the website's contact page.
  Valid reports create an `abuse_flags` row (reporter evidence reference +
  decision metadata only — no traffic data).
- Admin actions: warn, suspend, ban, revoke device — all write hash-chained
  audit rows.
- Because the service keeps no activity logs, abuse decisions are based on
  external reports and account-level signals, never on traffic inspection.

## 5. Responsible disclosure

If you find a security vulnerability, report it via the contact details on
the website's contact page. Please include steps to reproduce and do not
access other users' data. We aim to acknowledge within 5 business days.

## 6. Incident runbook

**Key compromise (JWT signing key, HMAC secret, TOTP enc key, Stripe/Resend secret):**

1. Rotate the secret immediately (`wrangler secret put <NAME>` with the new
   value; Workers pick it up on next deploy — deploy to force).
2. For `JWT_EDDSA_*`: deploy with the new keypair; all sessions
   re-authenticate (15-min access TTL bounds the window; refresh families
   are server-side and can be revoked row-by-row if needed).
3. For `NODE_AGENT_HMAC_SECRET`: set the new value in `/etc/veil-agent/agent.env`
   on every node and `systemctl restart veil-agent` (dual-secret rotation via
   `AGENT_HMAC_SECRET_PREV` is supported for zero-downtime rollover).
4. Write an audit note; notify users if account data may have been affected.

**Node compromise (suspected root on a VPN VM):**

1. In the admin console: set the node status to `draining`, then `offline`.
2. SSH in (or rebuild): rotate the WireGuard private key, the agent TLS
   cert/key, and the HMAC secret; re-image the VM if root compromise is
   confirmed (cheap: cloud-init + bootstrap is idempotent).
3. Re-register the node; move it back to `active` only after leak tests pass.
4. Nodes hold no user database — peer keys + pool IPs only — so user data
   exposure is limited to keys that were valid during the window; clients
   rotate keys on reconnect.

**Database leak (D1 export / backup exposure):**

1. What an attacker gets: emails, PBKDF2 password hashes (600k), public
   WireGuard keys, subscription states, payment event hashes. No traffic
   data exists to leak.
2. Force password resets for all users (invalidate refresh-token families),
   rotate JWT keys, notify users within 72 hours.
3. Rotate all provider secrets; review audit logs for anomalous admin
   actions.

**Webhook replay / forgery attempt:**

1. Webhooks are signature-verified with 5-minute skew and idempotent on
   `provider_event_id` — replays are dropped, forgeries are rejected (4xx).
2. If a provider secret is suspected leaked: rotate it in the provider
   dashboard + `wrangler secret put`, then check `payment_events` for
   duplicate or out-of-pattern rows.

After any incident: write a post-mortem note, keep the audit chain
verifiable (`GET /admin/audit-logs/verify`), and update this runbook with
what was learned.
