# VeilVPN node agent (`apps/node-agent`)

Go service (stdlib only — no external dependencies, for easy auditing) that
runs on every VPN exit node. It exposes a small HMAC-authenticated HTTPS API
used by the VeilVPN control plane (Cloudflare Worker) to add/remove
WireGuard peers, and runs a reconciler that continuously drives the live
`wg0` interface toward the desired state in `/var/lib/veil-agent/peers.json`.

## No-logs guarantee

The agent keeps **no traffic, DNS, or browsing logs — ever**:

- The only persisted data is the _desired peer set_ (public keys + tunnel
  IPs) in `/var/lib/veil-agent/peers.json` (0600) — the minimum needed to
  rebuild the interface after a reboot.
- `GET /metrics` exposes aggregate counts only (`peerCount`, `uptimeSec`,
  `version`, `interface`). There is deliberately **no** per-peer endpoint and
  no transfer counters.
- Structured JSON logs go to stdout (captured by journald). Peer public
  keys and tunnel IPs are **never** logged at info level or above; they can
  appear at `debug` level only, which is off unless `AGENT_DEBUG=1` /
  `LOG_LEVEL=debug` is set.
- The bootstrap (`infra/cloud-init/node-bootstrap.sh`) configures journald
  with `Storage=volatile` (16 MB cap), so logs live only in RAM and vanish on
  reboot. Unbound is configured with `log-queries: no` / `log-replies: no`.

## API reference

Base URL: `https://<node-ip>:8443` (port from `AGENT_PORT`). **Every**
endpoint requires HMAC authentication — there is no unauthenticated
endpoint, including `/health`.

| Method | Path              | Body / params                                                                   |
| ------ | ----------------- | ------------------------------------------------------------------------------- |
| POST   | `/peers`          | `{publicKey, assignedIp, dns?}` → `200 {ok, appliedAt}`                         |
| DELETE | `/peers/{pubkey}` | pubkey is base64; **must be URL-encoded** (`+` `/` `=`) → `200 {ok, removedAt}` |
| GET    | `/health`         | → `200 {ok, interface, peerCount, uptimeSec, version}`                          |
| GET    | `/metrics`        | → `200 {peerCount, uptimeSec, version, interface}`                              |

`POST /peers` validation:

- `publicKey`: exactly 44 chars, valid standard base64 decoding to 32 bytes.
- `assignedIp`: IPv4 inside `IP_POOL_CIDR`, excluding the network address,
  the broadcast address, and the gateway/DNS address (e.g. `10.7.0.1`).
- `dns` (optional): valid IPv4 if present; stored in desired state only.
- The same tunnel IP cannot be assigned to two different keys (`409
ip_in_use`).

Failure modes: invalid input → `400 invalid_peer` (or `invalid_json`);
WireGuard failure → `502 wireguard_error` (desired state is still saved, so
the reconciler retries); deleting an unknown peer → `404 peer_not_found`.
Errors follow the Phase 1 `ApiError` shape
`{error:{code,message},requestId}` and every response carries `X-Request-Id`.

### HMAC scheme (control plane → agent)

Exactly the Phase 1 contract:

```
bodyHash  = sha256_hex(raw request body)          # empty body -> sha256("")
message   = "<timestamp>.<method>.<path>.<bodyHash>"
signature = HMAC_SHA256_hex(key, message)
```

Headers: `X-Veil-Signature: <signature>`, `X-Veil-Timestamp: <timestamp>`
(Unix epoch seconds, ASCII). `<path>` is path + query string as sent
(`r.URL.RequestURI()`).

The verifier rejects when `|now - timestamp| > 300`s (constant-time
comparison), and rejects replays via an in-memory LRU of 10k seen
(timestamp, signature) pairs. Replay keys bind the timestamp to the
signature: two _distinct_ legitimate requests in the same second are
accepted, while an exact replay is always rejected.

### TLS: API pins the certificate fingerprint

The agent serves HTTPS with the cert/key from `AGENT_TLS_CERT` /
`AGENT_TLS_KEY`. Self-signed certificates are expected — the bootstrap
generates one and prints its SHA-256 fingerprint. The API **must not** rely
on CA trust or hostname verification; it pins the fingerprint instead.

Go snippet for the API side (Phase 2):

```go
fingerprint := "SHA256:AA:BB:..." // from bootstrap output, colons optional
pinned, _ := hex.DecodeString(strings.ReplaceAll(strings.TrimPrefix(fingerprint, "SHA256:"), ":", ""))
tr := &http.Transport{
    TLSClientConfig: &tls.Config{
        InsecureSkipVerify: true, // we verify the fingerprint ourselves
        VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
            if len(rawCerts) == 0 {
                return errors.New("no server certificate")
            }
            sum := sha256.Sum256(rawCerts[0])
            if !hmac.Equal(sum[:], pinned) {
                return errors.New("agent certificate fingerprint mismatch")
            }
            return nil
        },
    },
}
```

Rotate the fingerprint in the API config whenever the node certificate is
regenerated.

### Key rotation (HMAC secret)

1. Generate the new secret (≥ 32 chars) and set it as the API's
   `NODE_AGENT_HMAC_SECRET`.
2. On the node, set `AGENT_HMAC_SECRET_PREV` to the **old** secret and
   `AGENT_HMAC_SECRET` to the **new** secret in `/etc/veil-agent/agent.env`,
   then `systemctl restart veil-agent`.
3. The agent now accepts signatures from _both_ secrets. Once the API has
   fully cut over (no requests signed with the old secret are in flight —
   allow > 5 minutes for skew + retries), remove `AGENT_HMAC_SECRET_PREV`
   and restart again.

Never commit secrets to git; provision them via the bootstrap env or
`wrangler secret put` (API side).

## Reconciler

Every `PEER_SYNC_INTERVAL_SECONDS` (default 60s), plus once at startup, the
agent diffs desired state (`peers.json`) against `wg show <iface> peers`:
missing peers are added, unknown peers are removed. If the peer list cannot
be read (e.g. `wg0` is down), the pass is skipped **without changing
anything** (fail closed). Logs only aggregate counts
(`reconciled: desired=12 actual=12 added=0 removed=0`).

## Configuration

All configuration comes from the environment (see `.env.example`).
Required: `AGENT_HMAC_SECRET` (or legacy `VEIL_HMAC_SECRET`), `AGENT_TLS_CERT`,
`AGENT_TLS_KEY`. The process fails fast with a descriptive error on any
invalid value (bad CIDR, short secret, unreadable cert, …).

Env names the API needs to reach the agent (for Phase 2/3):

| Variable                 | Meaning                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Node's public IP         | the VM's public IPv4 address                                                          |
| `AGENT_PORT`             | agent HTTPS port (default `8443`)                                                     |
| `NODE_AGENT_HMAC_SECRET` | API-side name of the shared HMAC secret (agent reads `AGENT_HMAC_SECRET`; same value) |
| Agent TLS fingerprint    | `SHA256:...` printed by the bootstrap — pin this in the API's TLS config              |

Note: Phase 1 named the agent secret `VEIL_HMAC_SECRET` and the port
`WG_LISTEN_PORT` (the latter is actually the WireGuard UDP port, 51820 —
not the agent API port). This agent accepts `VEIL_HMAC_SECRET` as a
fallback, but `AGENT_HMAC_SECRET` / `AGENT_PORT` are canonical.

## Build, test, install

```bash
cd apps/node-agent
go build -trimpath -ldflags "-s -w -X main.version=1.0.0" -o veil-agent .
go vet ./...
go test ./...          # or: go test -race -count=1 ./...
```

Docker (needs `--cap-add=NET_ADMIN` at runtime, plus `wg` inside the image —
already included):

```bash
docker build --build-arg VERSION=1.0.0 -t veil-agent:1.0.0 .
docker run -d --cap-add=NET_ADMIN -v veil-state:/var/lib/veil-agent \
  -e AGENT_HMAC_SECRET=... -e AGENT_TLS_CERT=/tls/cert.pem -e AGENT_TLS_KEY=/tls/key.pem \
  -v /etc/veil-agent/tls:/tls:ro veil-agent:1.0.0
```

systemd: copy `deploy/veil-agent.service` to `/etc/systemd/system/`,
create `/etc/veil-agent/agent.env` (0600, root:veil), then
`systemctl daemon-reload && systemctl enable --now veil-agent`.
The bootstrap script automates all of this.
