#!/bin/bash
# VeilVPN Oracle node setup — run as root on Ubuntu 22.04
set -e

echo "=== VeilVPN Node Setup ==="

# 1. Install dependencies
apt-get update -qq
apt-get install -y -qq wireguard wireguard-tools iptables-persistent git curl wget > /dev/null 2>&1
# Install latest Go (Ubuntu's apt Go is too old for this codebase)
if ! /usr/local/go/bin/go version > /dev/null 2>&1; then
  GO_VER=$(curl -s https://go.dev/VERSION?m=text | head -1)
  wget -q https://go.dev/dl/${GO_VER}.linux-amd64.tar.gz -O /tmp/go.tar.gz
  rm -rf /usr/local/go && tar -C /usr/local -xzf /tmp/go.tar.gz
fi
export PATH=$PATH:/usr/local/go/bin
echo "[1/7] Dependencies installed"

# 2. Generate WireGuard server keys
mkdir -p /etc/wireguard
umask 077
wg genkey | tee /etc/wireguard/server.key | wg pubkey > /etc/wireguard/server.pub
echo "[2/7] WireGuard keys generated"

# 3. Configure WireGuard interface
SERVER_PRIV=$(cat /etc/wireguard/server.key)
cat > /etc/wireguard/wg0.conf << EOF
[Interface]
PrivateKey = $SERVER_PRIV
Address = 10.7.0.1/24
ListenPort = 51820
PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ens3 -j MASQUERADE
PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ens3 -j MASQUERADE
EOF
chmod 600 /etc/wireguard/wg0.conf

# Enable IP forwarding
echo "net.ipv4.ip_forward=1" > /etc/sysctl.d/99-veil.conf
sysctl -p /etc/sysctl.d/99-veil.conf > /dev/null

# Start WireGuard
systemctl enable wg-quick@wg0 > /dev/null 2>&1
systemctl start wg-quick@wg0
echo "[3/7] WireGuard interface up"

# 4. Generate agent secrets
AGENT_DIR="/opt/veil-agent"
mkdir -p $AGENT_DIR /var/lib/veil-agent
HMAC_SECRET=$(openssl rand -hex 32)
echo "$HMAC_SECRET" > $AGENT_DIR/hmac.key
chmod 600 $AGENT_DIR/hmac.key

# Self-signed TLS cert for agent API
openssl req -x509 -newkey rsa:2048 -keyout $AGENT_DIR/tls.key -out $AGENT_DIR/tls.crt \
  -days 3650 -nodes -subj "/CN=veil-node-1" > /dev/null 2>&1
chmod 600 $AGENT_DIR/tls.key
echo "[4/7] Agent secrets generated"

# 5. Build node agent
if [ ! -d "$AGENT_DIR/src" ]; then
  git clone --depth 1 https://github.com/ibrahimpro007/veil-vpn.git $AGENT_DIR/src > /dev/null 2>&1
fi
cd $AGENT_DIR/src/apps/node-agent
go build -o $AGENT_DIR/veil-agent . > /dev/null 2>&1
echo "[5/7] Node agent built"

# 6. Systemd service
cat > /etc/systemd/system/veil-agent.service << EOF
[Unit]
Description=VeilVPN Node Agent
After=network.target wg-quick@wg0.service
Wants=wg-quick@wg0.service

[Service]
Type=simple
User=root
Environment=AGENT_HMAC_SECRET=$HMAC_SECRET
Environment=AGENT_TLS_CERT=$AGENT_DIR/tls.crt
Environment=AGENT_TLS_KEY=$AGENT_DIR/tls.key
Environment=AGENT_NODE_ID=veil-node-1
Environment=AGENT_PORT=8443
ExecStart=$AGENT_DIR/veil-agent
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable veil-agent > /dev/null 2>&1
systemctl start veil-agent
echo "[6/7] Agent service started"

# 7. Open firewall ports (Ubuntu UFW, if active)
ufw allow 51820/udp > /dev/null 2>&1 || true
ufw allow 8443/tcp > /dev/null 2>&1 || true

echo "[7/7] Done!"
echo ""
echo "=== SAVE THESE ==="
echo "WireGuard Public Key: $(cat /etc/wireguard/server.pub)"
echo "HMAC Secret: $HMAC_SECRET"
echo "Agent running: $(systemctl is-active veil-agent)"
echo "WireGuard running: $(systemctl is-active wg-quick@wg0)"
