# Oracle Cloud Always Free — VeilVPN node VM setup

Target: one ARM VM (`VM.Standard.A1.Flex`, 4 OCPU / 24 GB RAM) running
Ubuntu 24.04, hosting WireGuard (`wg0`), Unbound, nftables, and the
`veil-agent` control service. Budget: $0 (Always Free tier).

> Always Free limits (per tenancy, as of 2026): 4 OCPU + 24 GB RAM total
> across all Ampere A1 VMs, 200 GB boot volume total. One 4/24 VM uses the
> full Ampere allowance — plan accordingly if you run other A1 instances.

## Part 1 — create the VM (console click-path)

1. Sign in to <https://cloud.oracle.com> → hamburger menu → **Compute** →
   **Instances** → **Create instance**.
2. **Name**: `veil-node-1` (or `veil-node-<region>`). Pick a compartment.
3. **Placement**: keep the default availability domain.
4. **Image**: click _Change image_ → **Canonical Ubuntu** → **Canonical
   Ubuntu 24.04** (minimal is fine) → _Select image_.
5. **Shape**: click _Change shape_ → instance type **Virtual machine** →
   shape series **Ampere** → check **VM.Standard.A1.Flex** → set **OCPUs:
   4**, **Memory: 24 GB** → _Select shape_.
6. **Networking**: use the default VCN (create one if none exists) with
   **Assign a public IPv4 address** checked. Note the public IP after
   creation — the API needs it.
7. **Add SSH keys**: paste your public key (or generate & save a key pair).
8. **Boot volume**: default 50 GB is plenty; keep.
9. **Advanced options** → **Management** tab → **Cloud-init script** →
   paste the user-data from Part 2 below (it only stages the bootstrap env
   file and drops the installer; the real run happens in Part 3).
10. **Create**. Wait until the instance state is **Running** (lifecycle
    details show the public IP).

## Part 2 — cloud-init user-data (paste in step 9)

Replace the values, then paste the whole block as the cloud-init script:

```yaml
#cloud-config
write_files:
  - path: /root/veil-bootstrap.env
    permissions: "0600"
    owner: root:root
    content: |
      # REQUIRED: must match the API's NODE_AGENT_HMAC_SECRET (>= 32 chars)
      AGENT_HMAC_SECRET=REPLACE_WITH_64_HEX_CHARS
      # Comma-separated CIDRs allowed to reach the agent API (your API egress IPs)
      API_ALLOW_CIDRS=REPLACE_WITH_API_EGRESS_CIDRS
      # Optional overrides (defaults shown)
      WG_PORT=51820
      POOL_CIDR=10.7.0.0/24
      DNS_IP=10.7.0.1
      AGENT_PORT=8443
      # Binary source: release URL preferred; else set AGENT_SOURCE_DIR below
      AGENT_RELEASE_URL=https://github.com/YOUR_ORG/veil-vpn/releases/download/node-agent-v1.0.0/veil-agent-linux-arm64.tar.gz
      AGENT_VERSION=v1.0.0
      VEIL_NODE_ID=
runcmd:
  # Stage the installer script location (run it manually in Part 3 so you see the output)
  - mkdir -p /opt/veil-agent-install
```

> Why not run the bootstrap in cloud-init directly? The bootstrap takes
> several minutes (apt, keygen, service restarts) and prints secrets-adjacent
> material (TLS fingerprint, server public key) you want to see. Running it
> over SSH in Part 3 keeps that output in front of you. If you prefer fully
> unattended, append `- curl -fsSL <raw-node-bootstrap.sh-URL> -o
/opt/veil-agent-install/node-bootstrap.sh` and a final runcmd line:
> `bash /opt/veil-agent-install/node-bootstrap.sh` with
> `set -a; . /root/veil-bootstrap.env; set +a` — but then read
> `/var/log/veil-bootstrap.log` afterwards for the fingerprint.

## Part 3 — open firewall ports (VCN security list)

The VM's own nftables (installed by the bootstrap) is deny-by-default, but
Oracle's VCN security list is evaluated _first_ — you must open the ports
there too:

1. Hamburger → **Networking** → **Virtual cloud networks** → open your VCN
   → **Security lists** → open the default security list.
2. **Add ingress rules** (do both):
   - _Stateless_: unchecked. _Source type_: CIDR. _Source CIDR_:
     `0.0.0.0/0`. _IP protocol_: UDP. _Destination port range_: `51820`.
     _Description_: `VeilVPN WireGuard`.
   - _Source CIDR_: **your API egress IPs only** (same as
     `API_ALLOW_CIDRS`). _IP protocol_: TCP. _Destination port range_:
     `8443` (or your `AGENT_PORT`). _Description_: `VeilVPN agent API`.
   - (SSH `22/tcp` from `0.0.0.0/0` already exists by default — keep it, or
     restrict it to your IP.)
3. No egress rule changes needed (default allow-all egress covers NAT,
   Unbound recursion, and the agent release download).

## Part 4 — run the bootstrap

```bash
ssh ubuntu@<node-public-ip>

# 1. get the installer (from the repo — replace ORG)
curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/veil-vpn/main/infra/cloud-init/node-bootstrap.sh \
  -o /tmp/node-bootstrap.sh
chmod +x /tmp/node-bootstrap.sh

# 2. run it with the env file staged by cloud-init
sudo bash -c 'set -a; . /root/veil-bootstrap.env; set +a; exec bash /tmp/node-bootstrap.sh'
```

The script is idempotent — re-running it after changing
`/root/veil-bootstrap.env` (e.g. adding `API_ALLOW_CIDRS`) safely applies
the delta. It logs to `/var/log/veil-bootstrap.log` **and** stdout.

On success it prints a summary including:

- the **server WireGuard public key** → register in the API (`vpn_nodes`)
  and bake into client configs,
- the **agent TLS SHA-256 fingerprint** → pin in the API's TLS config
  (see `apps/node-agent/README.md`),
- the agent health URL `https://<node-ip>:8443/health`.

## Part 5 — verify

```bash
# services
systemctl is-active wg-quick@wg0 nftables unbound fail2ban veil-agent

# WireGuard listening, nftables active, resolver answering via tunnel IP
sudo wg show wg0
sudo nft list ruleset | head -20
dig +short @10.7.0.1 example.com

# agent API (from a host in API_ALLOW_CIDRS; fingerprint pinned by the API)
# quick manual check needs an HMAC signature — the bootstrap's built-in
# python self-test already exercised this over 127.0.0.1.
sudo journalctl -u veil-agent --no-pager | tail -20
```

## Ongoing ops

- **OS patches**: `unattended-upgrades` is enabled (security updates daily).
- **Reboot**: `wg-quick@wg0`, `nftables`, `unbound`, `fail2ban`, and
  `veil-agent` are all `enable`d; the reconciler re-adds peers from
  `/var/lib/veil-agent/peers.json` within 60 s of boot.
- **Rotate the HMAC secret**: see `apps/node-agent/README.md` → Key rotation.
- **Regenerate the agent TLS cert**: delete
  `/etc/veil-agent/tls/{cert,key}.pem`, re-run the bootstrap, and update the
  pinned fingerprint in the API.
- **Logs**: journald is volatile (RAM only, 16 MB). `journalctl -u
veil-agent` works until reboot — by design (no persistent logs on the node).
