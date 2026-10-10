#!/usr/bin/env bash
# ============================================================================
# VeilVPN VPN-node bootstrap — full installer for Ubuntu 22.04/24.04 ARM
# (Oracle Cloud Always Free, VM.Standard.A1.Flex).
#
# What it does:
#   1. Installs packages: wireguard, nftables, unbound, fail2ban,
#      unattended-upgrades (+ openssl, curl, iproute2, python3).
#   2. Enables IPv4 forwarding; disables IPv6 forwarding (the tunnel is
#      IPv4-only — see the IPv6 note below).
#   3. Generates the server WireGuard keypair (if absent) and brings up wg0.
#   4. Installs nftables rules: NAT for the tunnel pool, forward-only-from-wg0,
#      inbound deny-by-default except 51820/udp and the agent API port from
#      an allowlist.
#   5. Configures Unbound as a local caching resolver on the pool gateway IP
#      with query logging DISABLED and DNSSEC on.
#   6. Enables fail2ban (sshd) and unattended-upgrades.
#   7. Installs the veil-agent Go binary (from AGENT_RELEASE_URL or from
#      source), its systemd unit, its env file, and a self-signed TLS cert;
#      prints the cert's SHA-256 fingerprint for API pinning.
#   8. Configures journald volatile storage (logs live only in RAM).
#
# IPv6 note: the tunnel pool is IPv4-only (10.7.0.0/24). Clients are
# configured with AllowedIPs = 0.0.0.0/0, ::/0 so ALL client traffic —
# including IPv6 — is routed into the tunnel (no cleartext IPv6 leak).
# Server-side, each peer's WireGuard allowed-ips is "<ip>/32" (IPv4 only),
# so IPv6 packets fail cryptokey routing and are dropped by WireGuard
# itself; IPv6 forwarding is additionally disabled node-wide. Net effect:
# IPv6 from clients is blackholed, never leaked, never routed.
#
# Idempotent: safe to re-run. Every step is either a no-op when already
# applied or rewrites deterministic content.
#
# Required env:  AGENT_HMAC_SECRET (>= 32 chars; must match the API's
#                NODE_AGENT_HMAC_SECRET)
# Optional env:  WG_PORT=51820 POOL_CIDR=10.7.0.0/24 DNS_IP=10.7.0.1
#                AGENT_PORT=8443 API_ALLOW_CIDRS="1.2.3.0/24,..."
#                AGENT_RELEASE_URL / AGENT_SOURCE_DIR=/opt/veil-agent
#                AGENT_VERSION=dev VEIL_NODE_ID=
# ============================================================================
set -euo pipefail

# --- logging: everything goes to the log file AND stdout ---
LOG_FILE="${BOOTSTRAP_LOG:-/var/log/veil-bootstrap.log}"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
exec > >(tee -a "$LOG_FILE") 2>&1

log()  { echo "[veil-bootstrap] $*"; }
warn() { echo "[veil-bootstrap] WARNING: $*" >&2; }
fail() { echo "[veil-bootstrap] FATAL: $*" >&2; exit 1; }

trap 'fail "unexpected error at line $LINENO (see above)"' ERR

if [ "$(id -u)" -ne 0 ]; then
  fail "run as root (e.g. sudo bash node-bootstrap.sh)"
fi

# --- 1. configuration -------------------------------------------------------
WG_PORT="${WG_PORT:-51820}"
POOL_CIDR="${POOL_CIDR:-10.7.0.0/24}"
DNS_IP="${DNS_IP:-10.7.0.1}"
AGENT_PORT="${AGENT_PORT:-8443}"
API_ALLOW_CIDRS="${API_ALLOW_CIDRS:-}"
AGENT_RELEASE_URL="${AGENT_RELEASE_URL:-}"
AGENT_SOURCE_DIR="${AGENT_SOURCE_DIR:-/opt/veil-agent}"
AGENT_VERSION="${AGENT_VERSION:-bootstrap}"
VEIL_NODE_ID="${VEIL_NODE_ID:-}"
AGENT_HMAC_SECRET="${AGENT_HMAC_SECRET:-}"
AGENT_HMAC_SECRET_PREV="${AGENT_HMAC_SECRET_PREV:-}"

[ -n "$AGENT_HMAC_SECRET" ] || fail "AGENT_HMAC_SECRET is required (must match the API's NODE_AGENT_HMAC_SECRET)"
[ "${#AGENT_HMAC_SECRET}" -ge 32 ] || fail "AGENT_HMAC_SECRET must be at least 32 characters"

# Validate CIDRs with python3 (no extra deps).
validate_cidr() {
  python3 - "$1" <<'EOF' || fail "invalid CIDR: $1"
import ipaddress, sys
try:
    ipaddress.ip_network(sys.argv[1], strict=False)
except Exception as e:
    print("invalid CIDR %s: %s" % (sys.argv[1], e), file=sys.stderr)
    sys.exit(1)
EOF
}
validate_cidr "$POOL_CIDR"
POOL_PREFIX="${POOL_CIDR#*/}"
ALLOW_ENTRIES=""
if [ -n "$API_ALLOW_CIDRS" ]; then
  for cidr in $(echo "$API_ALLOW_CIDRS" | tr ',' ' '); do
    cidr="$(echo "$cidr" | tr -d '[:space:]')"
    [ -n "$cidr" ] || continue
    validate_cidr "$cidr"
    ALLOW_ENTRIES="${ALLOW_ENTRIES}${ALLOW_ENTRIES:+, }${cidr}"
  done
fi

log "starting VeilVPN node bootstrap"
log "config: WG_PORT=$WG_PORT POOL_CIDR=$POOL_CIDR DNS_IP=$DNS_IP AGENT_PORT=$AGENT_PORT"

# --- 2. packages -------------------------------------------------------------
log "installing packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  wireguard wireguard-tools \
  nftables \
  unbound \
  fail2ban \
  unattended-upgrades \
  openssl curl ca-certificates iproute2 python3 jq dnsutils

# --- 3. kernel forwarding ----------------------------------------------------
log "configuring sysctl (IPv4 forwarding on, IPv6 forwarding off)"
cat > /etc/sysctl.d/99-veil.conf <<'EOF'
# VeilVPN node: IPv4-only tunnel (see bootstrap header for the IPv6 story).
net.ipv4.ip_forward=1
net.ipv6.conf.all.forwarding=0
net.ipv6.conf.default.forwarding=0
EOF
sysctl --system >/dev/null

# --- 4. system user -----------------------------------------------------------
if ! id veil >/dev/null 2>&1; then
  log "creating veil system user"
  useradd --system --no-create-home --shell /usr/sbin/nologin veil
fi

# --- 5. WireGuard server keypair + wg0 ---------------------------------------
log "setting up WireGuard server keypair"
mkdir -p /etc/wireguard
chmod 700 /etc/wireguard
if [ ! -f /etc/wireguard/server.key ]; then
  log "generating new server keypair"
  umask 077
  wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
  chmod 600 /etc/wireguard/server.key
  chmod 644 /etc/wireguard/server.pub
else
  log "server keypair already exists, reusing"
fi
SERVER_PRIVATE_KEY="${SERVER_PRIVATE_KEY:-$(cat /etc/wireguard/server.key)}"
SERVER_PUBLIC_KEY="$(cat /etc/wireguard/server.pub)"
[ -n "$SERVER_PRIVATE_KEY" ] || fail "could not obtain server private key"

log "writing /etc/wireguard/wg0.conf"
cat > /etc/wireguard/wg0.conf <<EOF
# VeilVPN exit node — managed by node-bootstrap.sh (idempotent rewrite).
[Interface]
PrivateKey = ${SERVER_PRIVATE_KEY}
Address = ${DNS_IP}/${POOL_PREFIX}
ListenPort = ${WG_PORT}
EOF
chmod 600 /etc/wireguard/wg0.conf

log "bringing up wg0"
systemctl enable wg-quick@wg0 >/dev/null 2>&1 || true
if systemctl is-active --quiet wg-quick@wg0 2>/dev/null; then
  systemctl restart wg-quick@wg0
else
  # Not under a working systemd, or first run: use wg-quick directly.
  wg-quick down wg0 2>/dev/null || true
  wg-quick up wg0
fi
ip link show wg0 >/dev/null || fail "wg0 did not come up"

# Detect the uplink (public) interface for NAT.
UPLINK_IF="$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="dev") print $(i+1)}' | head -n1)"
if [ -z "$UPLINK_IF" ]; then
  UPLINK_IF="$(ip -4 route show default 2>/dev/null | awk '{print $5}' | head -n1)"
fi
[ -n "$UPLINK_IF" ] || fail "could not detect uplink interface"
log "uplink interface: $UPLINK_IF"

# --- 6. nftables firewall ------------------------------------------------------
log "writing nftables ruleset"
AGENT_RULE="# agent API: API_ALLOW_CIDRS is empty -> agent port stays closed (default deny)"
if [ -n "$ALLOW_ENTRIES" ]; then
  AGENT_RULE="tcp dport \$agent_port ip saddr { ${ALLOW_ENTRIES} } accept"
fi
cat > /etc/nftables.conf <<EOF
#!/usr/sbin/nft -f
# VeilVPN node firewall — managed by node-bootstrap.sh (idempotent rewrite).
# Default deny inbound. Outbound is open. Forward is tunnel-egress only.

flush ruleset

define pool4      = ${POOL_CIDR}
define wg_port    = ${WG_PORT}
define agent_port = ${AGENT_PORT}
define uplink     = "${UPLINK_IF}"

table inet veil {
    chain input {
        type filter hook input priority 0; policy drop;

        ct state established,related accept
        iifname "lo" accept

        # Oracle VCN DHCP client (keeps the VNIC's address; replies are
        # broadcast, hence the explicit rule rather than conntrack).
        udp sport 67 udp dport 68 accept

        # ICMP: ping allowed, rate-limited.
        icmp type echo-request limit rate over 5/second burst 5 packets drop
        icmp type echo-request accept

        # SSH: allowed; fail2ban provides brute-force protection.
        tcp dport 22 ct state new limit rate over 15/minute burst 5 packets drop
        tcp dport 22 accept

        # WireGuard tunnel.
        udp dport \$wg_port accept

        # Node-agent control API — allowlisted API IPs only.
        ${AGENT_RULE}
    }

    chain forward {
        type filter hook forward priority 0; policy drop;

        # Tunnel clients may only forward OUT toward the internet (NATed
        # below). Client-to-client and inbound-new flows are dropped.
        iifname "wg0" oifname \$uplink ip saddr \$pool4 accept
        ct state established,related accept
    }

    chain output {
        type filter hook output priority 0; policy accept;
    }
}

table ip veil_nat {
    chain postrouting {
        type nat hook postrouting priority srcnat; policy accept;
        ip saddr \$pool4 oifname \$uplink masquerade
    }
}
EOF

nft --check -f /etc/nftables.conf || fail "nftables ruleset failed syntax check"
systemctl enable --now nftables
nft list ruleset | grep -q 'table inet veil' || fail "veil nftables rules not active"
if [ -z "$ALLOW_ENTRIES" ]; then
  warn "API_ALLOW_CIDRS is empty: the agent API port ($AGENT_PORT/tcp) is CLOSED."
  warn "Set API_ALLOW_CIDRS to the API's egress IPs/CIDRs and re-run this script to open it."
fi

# --- 7. Unbound: private caching resolver --------------------------------------
log "configuring Unbound (no query logging, DNSSEC on)"
mkdir -p /var/lib/unbound
if [ ! -f /var/lib/unbound/root.key ]; then
  log "fetching DNSSEC root trust anchor"
  if ! unbound-anchor -a /var/lib/unbound/root.key 2>/dev/null; then
    warn "unbound-anchor failed; falling back to dns-root-data package"
    apt-get install -y -qq dns-root-data
    cp /usr/share/dns/root.key /var/lib/unbound/root.key
  fi
fi
chown -R unbound:unbound /var/lib/unbound 2>/dev/null || chown -R unbound /var/lib/unbound

cat > /etc/unbound/unbound.conf.d/veil.conf <<EOF
# VeilVPN node resolver — managed by node-bootstrap.sh (idempotent rewrite).
server:
    interface: ${DNS_IP}
    port: 53
    do-ip4: yes
    do-ip6: no
    do-udp: yes
    do-tcp: yes
    access-control: ${POOL_CIDR} allow
    access-control: 127.0.0.0/8 allow

    # ---- privacy: NEVER log queries (no-logs invariant) ----
    log-queries: no
    log-replies: no
    statistics-interval: 0
    statistics-cumulative: no

    hide-identity: yes
    hide-version: yes
    qname-minimisation: yes

    # ---- DNSSEC ----
    auto-trust-anchor-file: "/var/lib/unbound/root.key"
    val-log-level: 1

    msg-cache-size: 16m
    rrset-cache-size: 32m
EOF

unbound-checkconf || fail "unbound configuration invalid"
if systemctl is-active --quiet unbound 2>/dev/null; then
  systemctl restart unbound
else
  systemctl enable --now unbound
fi
# Smoke-test the resolver through the tunnel gateway address.
if ! dig +short +time=3 +tries=2 @"$DNS_IP" example.com A >/dev/null 2>&1; then
  warn "unbound did not answer on $DNS_IP:53 (dig check failed); check 'systemctl status unbound'"
fi

# --- 8. fail2ban ---------------------------------------------------------------
log "configuring fail2ban (sshd)"
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/veil.conf <<'EOF'
# VeilVPN node — managed by node-bootstrap.sh (idempotent rewrite).
[sshd]
enabled = true
banaction = nftables
maxretry = 5
bantime = 3600
EOF
systemctl enable --now fail2ban
log "note: the agent API port is NOT behind fail2ban by design — it is"
log "      restricted by the nftables IP allowlist, requires a 256-bit HMAC"
log "      per request, and rejects replays; brute force is infeasible."

# --- 9. unattended upgrades ----------------------------------------------------
log "enabling unattended-upgrades"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# --- 10. veil-agent binary -----------------------------------------------------
AGENT_BIN="/usr/local/bin/veil-agent"
install_from_url() {
  log "downloading agent from AGENT_RELEASE_URL"
  local tmp bin
  tmp="$(mktemp -d)"
  # shellcheck disable=SC2064
  trap "rm -rf '$tmp'" RETURN
  curl -fsSL --retry 3 -o "$tmp/download" "$AGENT_RELEASE_URL" \
    || fail "download failed: $AGENT_RELEASE_URL"
  case "$AGENT_RELEASE_URL" in
    *.tar.gz|*.tgz)
      tar -xzf "$tmp/download" -C "$tmp"
      bin="$(find "$tmp" -name veil-agent -type f | head -n1)"
      ;;
    *.gz)
      gunzip -c "$tmp/download" > "$tmp/veil-agent"
      bin="$tmp/veil-agent"
      ;;
    *)
      bin="$tmp/download"
      ;;
  esac
  [ -n "${bin:-}" ] && [ -f "$bin" ] || fail "no veil-agent binary found in release artifact"
  install -m 0755 "$bin" "$AGENT_BIN"
}
install_from_source() {
  local src="${AGENT_SOURCE_DIR}/apps/node-agent"
  [ -f "$src/go.mod" ] || fail "no Go source at $src and AGENT_RELEASE_URL is not set"
  command -v go >/dev/null || fail "go toolchain not found and AGENT_RELEASE_URL is not set"
  log "building agent from source ($src)"
  ( cd "$src" && CGO_ENABLED=0 go build -trimpath \
      -ldflags "-s -w -X main.version=${AGENT_VERSION}" -o "$AGENT_BIN" . )
  chmod 0755 "$AGENT_BIN"
}
if [ -n "$AGENT_RELEASE_URL" ]; then
  install_from_url
elif [ -f "${AGENT_SOURCE_DIR}/apps/node-agent/go.mod" ]; then
  install_from_source
else
  fail "set AGENT_RELEASE_URL (release binary) or place the repo at AGENT_SOURCE_DIR ($AGENT_SOURCE_DIR)"
fi
[ -x "$AGENT_BIN" ] || fail "agent binary not installed at $AGENT_BIN"
log "agent binary installed: $AGENT_BIN"

# --- 11. agent env file + TLS cert ---------------------------------------------
log "writing /etc/veil-agent/agent.env"
mkdir -p /etc/veil-agent/tls /var/lib/veil-agent
# NOTE: single-pass heredoc expansion — secret values are inserted literally.
cat > /etc/veil-agent/agent.env <<EOF
# VeilVPN node agent environment — managed by node-bootstrap.sh.
AGENT_PORT=${AGENT_PORT}
AGENT_BIND=0.0.0.0
AGENT_HMAC_SECRET=${AGENT_HMAC_SECRET}
AGENT_HMAC_SECRET_PREV=${AGENT_HMAC_SECRET_PREV}
WG_INTERFACE=wg0
IP_POOL_CIDR=${POOL_CIDR}
PEER_SYNC_INTERVAL_SECONDS=60
AGENT_TLS_CERT=/etc/veil-agent/tls/cert.pem
AGENT_TLS_KEY=/etc/veil-agent/tls/key.pem
AGENT_STATE_DIR=/var/lib/veil-agent
VEIL_NODE_ID=${VEIL_NODE_ID}
EOF
chown root:veil /etc/veil-agent/agent.env
chmod 640 /etc/veil-agent/agent.env
chown veil:veil /var/lib/veil-agent
chmod 700 /var/lib/veil-agent

if [ ! -f /etc/veil-agent/tls/cert.pem ] || [ ! -f /etc/veil-agent/tls/key.pem ]; then
  log "generating self-signed TLS certificate for the agent API (825 days)"
  openssl req -x509 -newkey rsa:2048 -nodes \
    -keyout /etc/veil-agent/tls/key.pem \
    -out /etc/veil-agent/tls/cert.pem \
    -days 825 -subj "/CN=veil-agent" \
    -addext "subjectAltName=DNS:veil-agent,IP:127.0.0.1"
  chown root:veil /etc/veil-agent/tls/key.pem
  chmod 640 /etc/veil-agent/tls/key.pem
  chmod 644 /etc/veil-agent/tls/cert.pem
else
  log "agent TLS certificate already exists, reusing"
fi
AGENT_FINGERPRINT="$(openssl x509 -in /etc/veil-agent/tls/cert.pem -noout -fingerprint -sha256 | sed 's/^[^=]*=//')"
[ -n "$AGENT_FINGERPRINT" ] || fail "could not read agent TLS fingerprint"

# --- 12. systemd unit ------------------------------------------------------------
UNIT_SRC="${AGENT_SOURCE_DIR}/apps/node-agent/deploy/veil-agent.service"
if [ -f "$UNIT_SRC" ]; then
  log "installing systemd unit from $UNIT_SRC"
  cp "$UNIT_SRC" /etc/systemd/system/veil-agent.service
else
  log "source unit not found; writing embedded fallback unit"
  cat > /etc/systemd/system/veil-agent.service <<'UNIT_EOF'
[Unit]
Description=VeilVPN node agent (WireGuard peer sync)
Wants=network-online.target wg-quick@wg0.service
After=network-online.target wg-quick@wg0.service

[Service]
Type=notify
NotifyAccess=main
User=veil
Group=veil
EnvironmentFile=/etc/veil-agent/agent.env
ExecStart=/usr/local/bin/veil-agent
Restart=on-failure
RestartSec=5s
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ProtectHostname=true
ProtectClock=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectKernelLogs=true
ProtectControlGroups=true
RestrictNamespaces=true
LockPersonality=true
RemoveIPC=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK
SystemCallArchitectures=native
CapabilityBoundingSet=CAP_NET_ADMIN
AmbientCapabilities=CAP_NET_ADMIN
ReadWritePaths=/var/lib/veil-agent
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT_EOF
fi
chmod 644 /etc/systemd/system/veil-agent.service
systemctl daemon-reload
systemctl enable --now veil-agent
sleep 2
systemctl is-active --quiet veil-agent || fail "veil-agent service failed to start (see: journalctl -u veil-agent)"

# --- 13. journald: volatile storage (privacy) --------------------------------------
log "configuring journald volatile storage (logs live only in RAM)"
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/volatile.conf <<'EOF'
# VeilVPN node — managed by node-bootstrap.sh.
# Privacy: node logs (incl. the agent's JSON logs) are kept in RAM only and
# vanish on reboot. 16 MB cap.
[Journal]
Storage=volatile
SystemMaxUse=16M
RuntimeMaxUse=16M
EOF
systemctl restart systemd-journald || warn "could not restart systemd-journald"

# --- 14. end-to-end self-test ------------------------------------------------------
log "running authenticated self-test against the agent API"
python3 - "$AGENT_HMAC_SECRET" "$AGENT_PORT" <<'EOF' || warn "agent API self-test FAILED (service is up; check HMAC/TLS manually)"
import hashlib, hmac, json, ssl, sys, time, urllib.request

secret, port = sys.argv[1].encode(), sys.argv[2]
ts = str(int(time.time()))
body = b""
body_hash = hashlib.sha256(body).hexdigest()
msg = ".".join([ts, "GET", "/health", body_hash])
sig = hmac.new(secret, msg.encode(), hashlib.sha256).hexdigest()

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
req = urllib.request.Request("https://127.0.0.1:%s/health" % port,
                             headers={"X-Veil-Signature": sig, "X-Veil-Timestamp": ts})
with urllib.request.urlopen(req, context=ctx, timeout=10) as r:
    data = json.load(r)
assert data.get("ok") is True, data
print("[veil-bootstrap] self-test OK: agent answered /health:", data)
EOF

# --- 15. summary -------------------------------------------------------------------
PEER_COUNT="$(wg show wg0 peers 2>/dev/null | grep -c . || true)"
cat <<EOF

================================================================
 VeilVPN node bootstrap complete
================================================================
 WireGuard : wg0 up on port ${WG_PORT}, pool ${POOL_CIDR} (NAT via ${UPLINK_IF})
 Server public key (give to the control plane / clients):
     ${SERVER_PUBLIC_KEY}
 DNS       : Unbound on ${DNS_IP}:53, DNSSEC on, query logging OFF
 Agent API : https://<this-node-ip>:${AGENT_PORT}  (HMAC auth, TLS pinned)
 Agent TLS SHA-256 fingerprint (pin this in the API):
     SHA256:${AGENT_FINGERPRINT}
 Desired peers on record: ${PEER_COUNT}
 Firewall  : nftables active; inbound default-deny
             (51820/udp open; agent port ${AGENT_PORT}/tcp allowlisted: ${ALLOW_ENTRIES:-<none — port closed>})
 Logging   : journald volatile (RAM only, 16M cap); no traffic/DNS logs
 Next      : register this node in the API with the public key + fingerprint,
             then POST /peers via the API to attach clients.
 Full log  : ${LOG_FILE}
================================================================
EOF
trap - ERR
log "bootstrap finished successfully"
