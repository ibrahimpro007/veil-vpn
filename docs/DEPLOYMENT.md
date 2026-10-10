# VeilVPN — Deployment Runbook

Exact copy-paste steps to take VeilVPN from this repo to production. Run
commands from the repo root (`~/workspace/veil-vpn`) unless noted.

> Budget: $0. Everything below uses free tiers. Stripe stays in **test
> mode** until you deliberately switch it live.

## 0. Prerequisites

- Node 20 + pnpm 9.7.1 (`pnpm install --frozen-lockfile` passes)
- `wrangler` (ships in `apps/api` devDependencies; or `npm i -g wrangler`)
- A Cloudflare account (free plan) with Workers + D1 + KV enabled
- A Vercel account (Hobby, free)
- An Oracle Cloud account (Always Free) for the VPN node VM
- Stripe account (test mode), LemonSqueezy account (sandbox) — optional but
  recommended for billing
- Resend account (free tier) for transactional email
- `openssl`, `curl`, `bash`

```bash
wrangler login          # authenticate the Cloudflare CLI
pnpm install --frozen-lockfile
```

## 1. Cloudflare: D1 database + KV namespace

```bash
# Create the database (record the returned database_id)
wrangler d1 create veil-vpn-db

# Create the rate-limit KV namespace (record the returned id)
wrangler kv namespace create RATE_LIMIT
```

Edit `infra/wrangler.toml`: uncomment and fill `database_id` and the KV
`id`.

```bash
# Apply migrations in order, then seed the three plans
wrangler d1 migrations apply veil-vpn-db
wrangler d1 execute veil-vpn-db --file=infra/d1/seed.sql

# Sanity check
wrangler d1 execute veil-vpn-db --command="SELECT id, name, amount_cents FROM plans;"
```

## 2. Cloudflare: Worker secrets + public vars

Public (non-secret) vars go in `infra/wrangler.toml` under `[vars]`:

```toml
[vars]
APP_URL = "https://veil.example"
API_PUBLIC_URL = "https://api.veil.example"
ADMIN_URL = "https://admin.veil.example"
EMAIL_FROM = "noreply@veil.example"
JWT_ISSUER = "veil-api"
```

Generate the Ed25519 JWT keypair:

```bash
openssl genpkey -algorithm ed25519 -out /tmp/ed25519.pem
openssl pkey -in /tmp/ed25519.pem -pubout -out /tmp/ed25519-pub.pem
# Single-line, \n-escaped PEM for wrangler:
awk 'NF {printf "%s\\n", $0}' /tmp/ed25519.pem
awk 'NF {printf "%s\\n", $0}' /tmp/ed25519-pub.pem
```

Set every secret (values never committed; full descriptions in
`apps/api/.env.example`):

```bash
wrangler secret put JWT_EDDSA_PRIVATE_KEY        # \n-escaped PEM from above
wrangler secret put JWT_EDDSA_PUBLIC_KEY         # \n-escaped public PEM
wrangler secret put RESEND_API_KEY
wrangler secret put STRIPE_SECRET_KEY            # sk_test_... (TEST MODE)
wrangler secret put STRIPE_WEBHOOK_SECRET        # whsec_... from §6
wrangler secret put LEMONSQUEEZY_API_KEY
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET  # from §7
wrangler secret put NODE_AGENT_HMAC_SECRET       # >= 32 random chars, e.g. openssl rand -hex 32
wrangler secret put ADMIN_TOTP_ENC_KEY           # openssl rand -base64 32
wrangler secret put GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   # only if using Play (SKIPPED on $0 budget)
wrangler secret put APPLE_APPSTORE_PRIVATE_KEY         # only if using StoreKit (SKIPPED)
```

(`STRIPE_PUBLISHABLE_KEY`, `LEMONSQUEEZY_STORE_ID`, `APPLE_APPSTORE_ISSUER_ID`,
`APPLE_APPSTORE_KEY_ID` are public-ish config — put them in `[vars]` or as
secrets; the code reads them from env either way.)

## 3. Deploy the Worker

```bash
wrangler deploy --config infra/wrangler.toml
# Expected: Published veil-api (x.xxx sec)
#           https://veil-api.<your-subdomain>.workers.dev

curl -s https://veil-api.<your-subdomain>.workers.dev/v1/health
# {"status":"ok", ...}
```

Point your domain at the Worker (Cloudflare dashboard → Workers → Custom
Domains, or a `route` in `wrangler.toml`), so the API answers at
`https://api.veil.example`.

## 4. Vercel: admin console + marketing site (2 projects)

Create **two** separate Vercel projects (Hobby, free):

**Project 1 — admin** (root directory `apps/admin`):

```bash
# via dashboard: Add New → Project → import repo → set Root Directory to apps/admin
```

Environment variables:

- `NEXT_PUBLIC_API_BASE_URL=https://api.veil.example` (no trailing slash)
- `ADMIN_SESSION_SECRET=<redacted>` (reserved for future cookie sessions)
- `ADMIN_TOTP_ENC_KEY=` **must exactly match the API's value** from §2

**Project 2 — site** (root directory `apps/site`):

- `NEXT_PUBLIC_API_BASE_URL=https://api.veil.example`
- `NEXT_PUBLIC_GITHUB_REPO=<your-org>/veil-vpn` (download buttons point here)
- `NEXT_PUBLIC_APP_VERSION=v0.1.0`
- `NEXT_PUBLIC_SITE_URL=https://veil.example`
- `NEXT_PUBLIC_APP_URL=` (optional hosted portal; leave empty to direct
  users to in-app signup)

Attach domains: `admin.veil.example` → project 1, `veil.example` → project 2.

## 5. Oracle VM: VPN node

Follow `infra/cloud-init/ORACLE_VM_NOTES.md` exactly:

1. Create the VM (`veil-node-1`, Ampere A1 Flex, 4 OCPU / 24 GB, Ubuntu
   24.04, public IPv4, paste the cloud-init user-data with your
   `AGENT_HMAC_SECRET` — **the same value as `NODE_AGENT_HMAC_SECRET`**).
2. Open VCN security-list ingress: UDP 51820 from `0.0.0.0/0`; TCP 8443
   from your API egress IPs only.
3. SSH in and run the bootstrap:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/<your-org>/veil-vpn/main/infra/cloud-init/node-bootstrap.sh \
     -o /tmp/node-bootstrap.sh
   chmod +x /tmp/node-bootstrap.sh
   sudo bash -c 'set -a; . /root/veil-bootstrap.env; set +a; exec bash /tmp/node-bootstrap.sh'
   ```
4. Note from the output: the **server WireGuard public key** and the
   **agent TLS SHA-256 fingerprint**.

## 6. Register the node in the admin console

1. Create the first owner admin (§8), log in at `https://admin.veil.example`.
2. **Nodes → Register node**: region `eu-west`, country `DE`, city
   `Frankfurt`, endpoint `<node-public-ip>:51820`, the WireGuard public key
   from the bootstrap output, capacity `250`, pool `10.7.0.0/24`, DNS
   `10.7.0.1`. (API: `POST /admin/nodes` — the node starts **disabled**.)
3. Verify the agent health endpoint and pin the TLS fingerprint per
   `apps/node-agent/README.md`.
4. Run the leak-test checklist (`docs/LEAK_TESTS.md`) against the node.
5. Flip the node to **active** (PATCH, or the UI toggle).

## 7. Stripe webhook (test mode)

1. Stripe Dashboard → Developers → Webhooks → **Add endpoint**:
   `https://api.veil.example/v1/webhooks/stripe`
2. Subscribe to events:
   - `checkout.session.completed`
   - `invoice.paid`
   - `invoice.payment_failed`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `charge.refunded`
   - `charge.dispute.created`
3. Copy the **signing secret** (`whsec_...`) → `wrangler secret put STRIPE_WEBHOOK_SECRET`, then redeploy the Worker.
4. Trigger a test event from the dashboard; confirm a row appears in
   Admin → Payments and `payment_events.provider_event_id` dedupes replays.

## 8. LemonSqueezy webhook (sandbox)

1. LemonSqueezy → Settings → Webhooks → Add: `https://api.veil.example/v1/webhooks/lemonsqueezy`
2. Select events: `subscription_created`, `subscription_updated`,
   `subscription_resumed`, `subscription_unpaused`,
   `subscription_payment_failed`, `subscription_paused`,
   `subscription_cancelled`, `subscription_expired`, `order_created`.
3. Copy the signing secret → `wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET`, redeploy.

## 9. First owner admin

```bash
ADMIN_TOTP_ENC_KEY="$(openssl rand -base64 32)" \
  node apps/api/scripts/bootstrap-admin.mjs --email you@example.com --role owner
# 1. Enter a password (min 12 chars) when prompted.
# 2. Scan the printed otpauth:// URL into your authenticator app NOW.
# 3. The script prints SQL — save to /tmp/veil-admin.sql and run:
wrangler d1 execute veil-vpn-db --file=/tmp/veil-admin.sql
rm /tmp/veil-admin.sql
```

> Use the **same** `ADMIN_TOTP_ENC_KEY` for the Worker secret (§2) and the
> Vercel admin env (§4).

## 10. Smoke test

```bash
API_BASE=https://api.veil.example bash infra/scripts/smoke-test.sh
```

Expected: `GET /v1/health` 200, register 201 (409 on rerun), a 429 observed
under the hammer test, `/v1/nodes` listing your node without load data.

## 11. Release a client build

```bash
git tag v0.1.0 && git push origin v0.1.0
```

`.github/workflows/release.yml` builds the Windows installer (Inno Setup,
self-signed), the Android APK (direct flavor, keystore from secrets), and
the macOS DMG (ad-hoc signed), then publishes them to the GitHub Release
with `SHA256SUMS.txt`. The site's download page picks them up automatically
via `NEXT_PUBLIC_GITHUB_REPO`.

## Rollback

- **Worker:** `wrangler rollback --config infra/wrangler.toml` (restores the
  previous deployment), or `wrangler deploy` a known-good commit.
- **Vercel (admin/site):** dashboard → Deployments → **Promote to
  Production** on the previous good deployment.
- **D1 migrations:** D1 has no down-migrations. Policy is **forward-fix
  only**: write a new migration that repairs the schema/data, apply it,
  and record what happened in `BUILD_REPORT.md`. Never hand-edit prod D1
  outside a migration.
- **Node agent:** `systemctl stop veil-agent`, install the previous release
  binary from GitHub Releases, `systemctl start veil-agent`; peers
  re-reconcile from `/var/lib/veil-agent/peers.json` within 60 s.
- **Secrets:** if a rollback spans a secret rotation, re-apply the
  previous secret value first (keep the last two values in your password
  manager during rotations).

## Ongoing ops

- D1 backups: `pnpm db:backup` (keeps 14 timestamped exports; store them
  encrypted/off-repo — they contain emails and password hashes).
- Weekly: review the `security.yml` scan results; rotate nothing on a
  schedule, rotate immediately on suspicion (see SECURITY.md §6).
- Before every client release: `docs/LEAK_TESTS.md` on real devices.
