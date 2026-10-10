# VeilVPN

A no-logs VPN service built entirely on free tiers: a Cloudflare Worker API
with D1 storage, Go WireGuard node agents on Oracle Always Free VMs, a
Next.js admin console, a Flutter client (Windows / Android / macOS) shipped
via GitHub Releases, and a marketing/download site.

**Status:** all phases implemented (API, node agent, admin, client, site,
CI/CD, docs). See [BUILD_REPORT.md](BUILD_REPORT.md) for test results and
honest limitations.

## Architecture

```
                    ┌─────────────────────────┐
                    │  Flutter client          │
                    │  (Windows/Android/macOS) │
                    └────────────┬────────────┘
                                 │ HTTPS (WireGuard keys in-app,
                                 │         tunnel via platform adapters)
                    ┌────────────▼────────────┐      HMAC-signed control calls
                    │  Cloudflare Worker API  │◄──────────────────────────┐
                    │  (Hono + Drizzle + D1)  │  add/remove WireGuard peer │
                    └──────┬──────────┬───────┘                           │
                           │          │                              ┌────┴────────────┐
                     D1    │          │ KV (rate limits)               │  Go node agent  │
                  (SQLite) │          │                                │  + WireGuard    │
                           │          │                                │  (Oracle VM)    │
                    ┌──────▼──────────▼───────┐                        └─────────────────┘
                    │  Next.js admin console  │   Next.js marketing/download site
                    │  (Vercel)               │   (Vercel → GitHub Releases)
                    └─────────────────────────┘
```

**Data flows:**

1. Client registers / logs in → Worker (PBKDF2-hashed passwords, Ed25519
   short-lived JWTs, rotating refresh-token families).
2. Client registers a device (WireGuard public key) → Worker.
3. Client taps connect → Worker checks entitlement from `subscriptions`,
   picks the least-loaded active node, allocates a pool IP (UNIQUE-retry
   loop), HMAC-signs an add-peer call to the Go node agent; agent applies it
   to `wg0` via `wg`/`nftables`. Client receives a `WireGuardPeerConfig`
   and brings up the tunnel through its platform adapter.
4. Billing: Stripe / LemonSqueezy webhooks (signature-verified, idempotent
   via `payment_events.provider_event_id`). Only the SHA-256 of the raw
   payload is stored — never the payload.
5. Cron sweeps (every 15 min / hourly) revoke lapsed peers and purge
   expired tokens.

**No-logs by schema design:** there is no table or field for traffic, DNS,
browsing history, or precise connection times. `devices.last_seen_coarse`
stores only a calendar day (YYYYMMDD). `GET /v1/nodes` exposes
region/country/city/endpoint/status only — never load, capacity, or peer
counts.

## Repo layout

```
veil-vpn/
├── apps/api/            Cloudflare Worker: all /v1/* + /admin/* routes, crons,
│                        webhooks, bootstrap-admin.mjs script          (Phase 2/3)
├── apps/node-agent/     Go service on each VPN node: HMAC authed control API,
│                        WireGuard peer sync, systemd unit, installer docs (Phase 4)
├── apps/admin/          Next.js 14 admin console (users, subs, nodes, audit) (Phase 5)
├── apps/client/         Flutter client: Windows/Android/macOS, direct-download
│                        flavor, store flavors dormant                    (Phase 7)
├── apps/site/           Next.js 14 marketing + download site → GitHub Releases (Phase 6)
├── packages/shared/     Zod schemas, TS types, OpenAPI 3.1 spec (source of truth)
├── infra/
│   ├── wrangler.toml    Worker bindings (DB, RATE_LIMIT KV), crons
│   ├── vercel.json      monorepo template (per-app configs live in apps/*)
│   ├── d1/migrations/   0001_init.sql, 0002_profile_name.sql, 0003_provider_customer.sql
│   ├── d1/seed.sql      plans (trial $0, monthly $4.99, yearly $49.99)
│   ├── scripts/         backup-d1.sh, smoke-test.sh
│   └── cloud-init/      ORACLE_VM_NOTES.md, node-bootstrap.sh
├── .github/workflows/   ci.yml, release.yml (tag v* → installers), security.yml
├── docs/                DEPLOYMENT.md, LEAK_TESTS.md, LOAD_TEST.md
├── README.md  COSTS.md  SECURITY.md  PRIVACY_POLICY.md  TERMS.md  ACCEPTABLE_USE.md
├── PHASE1_NOTES.md      contracts for all phases (read first)
├── PHASE23_NOTES.md     API implementation decisions + deviations
└── BUILD_REPORT.md      test results + honest limitations
```

## Assumptions (pinned)

- **Name:** VeilVPN everywhere (package names, bundle ids `com.veil.vpn`,
  env files, docs).
- **$0 budget:** free tiers only. Direct downloads via GitHub Releases —
  **no store listings** (Google Play $25 and Apple Developer $99/yr are
  SKIPPED; store billing code is dormant).
- **Stripe in TEST MODE** until real billing is deliberately switched on.
- **Resend free tier** (100 emails/day) for verification/reset emails.
- **Single Oracle region** to start (one Always Free ARM VM: 4 OCPU / 24 GB).
- **Self-signed certificates** everywhere a CA cert would normally be used
  (Windows installer, macOS app, node-agent TLS with API fingerprint
  pinning). Documented warnings included; CA/EV certs SKIPPED.
- **Tunnel adapters need real-device testing** — leak tests in
  `docs/LEAK_TESTS.md` must pass on each platform before a release is
  called good.
- **No independent security audit** has been performed.

## Quickstart (local dev)

Prerequisites: Node 20, pnpm 9.7.1, Go 1.22+, Flutter (for the client).

```bash
pnpm install                    # frozen lockfile
pnpm turbo run typecheck         # tsc --noEmit everywhere
pnpm turbo run build             # build all JS/TS workspaces
pnpm turbo run test              # vitest (apps/api, 57 tests)
pnpm test:all                    # JS tests + Go tests (skips Go if absent)

# API against a local D1 file (see apps/api/.env.example → .dev.vars):
cd apps/api && pnpm dev          # wrangler dev

# Admin / site:
cd apps/admin && pnpm dev        # :3001
cd apps/site && pnpm dev         # :3000

# Node agent tests:
cd apps/node-agent && go test ./...
```

Production deployment: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) (exact
copy-paste steps, secrets, webhooks, bootstrap, smoke test, rollback).

## Docs

- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — exact deploy steps + rollback.
- [docs/LEAK_TESTS.md](docs/LEAK_TESTS.md) — leak/kill-switch checklist.
- [docs/LOAD_TEST.md](docs/LOAD_TEST.md) — free-tier limits + k6 script.
- [COSTS.md](COSTS.md) — every service, free-tier allowance, total $0.
- [SECURITY.md](SECURITY.md) — threat model, crypto, incident runbook.
- [PRIVACY_POLICY.md](PRIVACY_POLICY.md), [TERMS.md](TERMS.md),
  [ACCEPTABLE_USE.md](ACCEPTABLE_USE.md) — legal templates (match the
  live pages at `/privacy`, `/terms`, `/acceptable-use` on the site).
- [PHASE1_NOTES.md](PHASE1_NOTES.md) — cross-phase contracts.
- [PHASE23_NOTES.md](PHASE23_NOTES.md) — API decisions and deviations.
- [BUILD_REPORT.md](BUILD_REPORT.md) — verification results + limitations.
