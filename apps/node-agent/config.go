package main

// Config: all runtime configuration comes from environment variables.
// Primary names are the AGENT_* names from the Phase 4 spec; where Phase 1
// defined an equivalent name (VEIL_HMAC_SECRET, WG_LISTEN_PORT, ...), it is
// accepted as a fallback and documented in README.md.

import (
	"crypto/tls"
	"fmt"
	"net"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAgentPort   = 8443
	defaultBind        = "0.0.0.0"
	defaultWGInterface = "wg0"
	defaultPoolCIDR    = "10.7.0.0/24"
	defaultSyncSeconds = 60
	defaultStateDir    = "/var/lib/veil-agent"
	minHMACSecretLen   = 32 // bytes; short secrets are rejected at startup
	maxSkewSeconds     = 300
	maxRequestBody     = 1 << 20 // 1 MiB
)

var ifnameRe = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,15}$`)

// Config holds the validated runtime configuration of the agent.
type Config struct {
	Bind           string
	Port           int
	HMACSecret     []byte // current signing secret
	HMACSecretPrev []byte // previous secret, accepted during rotation (may be nil)
	WGInterface    string
	TLSCertPath    string
	TLSKeyPath     string
	Pool           *net.IPNet // tunnel pool, e.g. 10.7.0.0/24
	GatewayIP      net.IP     // first usable pool address (reserved, never assigned)
	SyncInterval   time.Duration
	StateDir       string
	StateFile      string
	Debug          bool
	NodeID         string
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

// firstNonEmpty returns the first non-empty env value among keys.
func firstNonEmpty(keys ...string) string {
	for _, k := range keys {
		if v := os.Getenv(k); v != "" {
			return v
		}
	}
	return ""
}

// LoadConfig reads and validates configuration from the environment.
// It returns a descriptive error for any invalid value; the process must
// refuse to start (fail fast) when configuration is invalid.
func LoadConfig() (*Config, error) {
	var errs []string
	fail := func(format string, args ...any) {
		errs = append(errs, fmt.Sprintf(format, args...))
	}

	portStr := getenv("AGENT_PORT", strconv.Itoa(defaultAgentPort))
	port, err := strconv.Atoi(portStr)
	if err != nil || port < 1 || port > 65535 {
		fail("AGENT_PORT must be an integer 1-65535, got %q", portStr)
	}

	secret := firstNonEmpty("AGENT_HMAC_SECRET", "VEIL_HMAC_SECRET")
	if secret == "" {
		fail("AGENT_HMAC_SECRET (or legacy VEIL_HMAC_SECRET) is required")
	} else if len(secret) < minHMACSecretLen {
		fail("HMAC secret must be at least %d characters", minHMACSecretLen)
	}
	secretPrev := os.Getenv("AGENT_HMAC_SECRET_PREV")
	if secretPrev != "" && len(secretPrev) < minHMACSecretLen {
		fail("AGENT_HMAC_SECRET_PREV must be at least %d characters when set", minHMACSecretLen)
	}

	iface := getenv("WG_INTERFACE", defaultWGInterface)
	if !ifnameRe.MatchString(iface) {
		fail("WG_INTERFACE must be a valid Linux interface name (<=15 chars, [a-zA-Z0-9_-]), got %q", iface)
	}

	certPath := os.Getenv("AGENT_TLS_CERT")
	keyPath := os.Getenv("AGENT_TLS_KEY")
	if (certPath == "") != (keyPath == "") {
		fail("AGENT_TLS_CERT and AGENT_TLS_KEY must be set together (or neither, for HMAC-only HTTP mode)")
	} else if certPath != "" {
		if _, err := tls.LoadX509KeyPair(certPath, keyPath); err != nil {
			fail("cannot load TLS cert/key (%s, %s): %v", certPath, keyPath, err)
		}
	}

	poolCIDR := getenv("IP_POOL_CIDR", defaultPoolCIDR)
	_, pool, err := net.ParseCIDR(poolCIDR)
	if err != nil {
		fail("IP_POOL_CIDR is not a valid CIDR, got %q", poolCIDR)
	} else if pool.IP.To4() == nil {
		fail("IP_POOL_CIDR must be an IPv4 pool, got %q", poolCIDR)
	}

	syncStr := getenv("PEER_SYNC_INTERVAL_SECONDS", strconv.Itoa(defaultSyncSeconds))
	syncSec, err := strconv.Atoi(syncStr)
	if err != nil || syncSec < 10 || syncSec > 3600 {
		fail("PEER_SYNC_INTERVAL_SECONDS must be an integer 10-3600, got %q", syncStr)
	}

	stateDir := getenv("AGENT_STATE_DIR", defaultStateDir)
	if st, err := os.Stat(stateDir); err != nil {
		if mkErr := os.MkdirAll(stateDir, 0o700); mkErr != nil {
			fail("AGENT_STATE_DIR %q is not accessible and cannot be created: %v", stateDir, mkErr)
		}
	} else if !st.IsDir() {
		fail("AGENT_STATE_DIR %q is not a directory", stateDir)
	}

	if len(errs) > 0 {
		return nil, fmt.Errorf("invalid configuration:\n  - %s", strings.Join(errs, "\n  - "))
	}

	gateway := firstUsableIP(pool)

	debug := os.Getenv("AGENT_DEBUG") == "1" || strings.EqualFold(os.Getenv("LOG_LEVEL"), "debug")

	return &Config{
		Bind:           getenv("AGENT_BIND", defaultBind),
		Port:           port,
		HMACSecret:     []byte(secret),
		HMACSecretPrev: []byte(secretPrev),
		WGInterface:    iface,
		TLSCertPath:    certPath,
		TLSKeyPath:     keyPath,
		Pool:           pool,
		GatewayIP:      gateway,
		SyncInterval:   time.Duration(syncSec) * time.Second,
		StateDir:       stateDir,
		StateFile:      stateDir + "/peers.json",
		Debug:          debug,
		NodeID:         os.Getenv("VEIL_NODE_ID"),
	}, nil
}

// firstUsableIP returns pool network address + 1 (the gateway / DNS address).
func firstUsableIP(pool *net.IPNet) net.IP {
	ip := pool.IP.To4()
	gw := make(net.IP, len(ip))
	copy(gw, ip)
	for i := len(gw) - 1; i >= 0; i-- {
		gw[i]++
		if gw[i] != 0 {
			break
		}
	}
	return gw
}

// broadcastIP returns the pool broadcast address.
func broadcastIP(pool *net.IPNet) net.IP {
	ip := pool.IP.To4()
	mask := net.IP(pool.Mask).To4()
	bc := make(net.IP, 4)
	for i := 0; i < 4; i++ {
		bc[i] = ip[i] | ^mask[i]
	}
	return bc
}
