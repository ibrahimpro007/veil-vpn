package main

// Tests for environment configuration loading.

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"
)

// writeTestCert generates a throwaway self-signed cert/key pair and returns
// their paths.
func writeTestCert(t *testing.T) (certPath, keyPath string) {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject:      pkix.Name{CommonName: "veil-agent-test"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	certPath = filepath.Join(dir, "cert.pem")
	keyPath = filepath.Join(dir, "key.pem")
	certOut, _ := os.Create(certPath)
	_ = pem.Encode(certOut, &pem.Block{Type: "CERTIFICATE", Bytes: der})
	_ = certOut.Close()
	keyDER, _ := x509.MarshalECPrivateKey(key)
	keyOut, _ := os.Create(keyPath)
	_ = pem.Encode(keyOut, &pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER})
	_ = keyOut.Close()
	return certPath, keyPath
}

// setValidEnv installs a complete valid environment for LoadConfig.
func setValidEnv(t *testing.T) {
	t.Helper()
	cert, key := writeTestCert(t)
	t.Setenv("AGENT_PORT", "8443")
	t.Setenv("AGENT_HMAC_SECRET", "test-secret-0123456789abcdef-32ch")
	os.Unsetenv("AGENT_HMAC_SECRET_PREV")
	os.Unsetenv("VEIL_HMAC_SECRET")
	t.Setenv("WG_INTERFACE", "wg0")
	t.Setenv("AGENT_TLS_CERT", cert)
	t.Setenv("AGENT_TLS_KEY", key)
	t.Setenv("IP_POOL_CIDR", "10.7.0.0/24")
	t.Setenv("PEER_SYNC_INTERVAL_SECONDS", "60")
	t.Setenv("AGENT_STATE_DIR", t.TempDir())
	os.Unsetenv("AGENT_DEBUG")
	os.Unsetenv("LOG_LEVEL")
	os.Unsetenv("VEIL_NODE_ID")
	os.Unsetenv("AGENT_BIND")
}

func TestLoadConfigDefaults(t *testing.T) {
	setValidEnv(t)
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("valid env rejected: %v", err)
	}
	if cfg.Port != 8443 || cfg.Bind != "0.0.0.0" || cfg.WGInterface != "wg0" {
		t.Fatalf("bad defaults: %+v", cfg)
	}
	if cfg.Pool.String() != "10.7.0.0/24" {
		t.Fatalf("bad pool: %s", cfg.Pool)
	}
	if cfg.GatewayIP.String() != "10.7.0.1" {
		t.Fatalf("bad gateway: %s", cfg.GatewayIP)
	}
	if cfg.SyncInterval != 60*time.Second {
		t.Fatalf("bad sync interval: %v", cfg.SyncInterval)
	}
	if len(cfg.HMACSecretPrev) != 0 {
		t.Fatal("prev secret should be empty when unset")
	}
	if cfg.Debug {
		t.Fatal("debug should default off")
	}
}

func TestLoadConfigMissingSecret(t *testing.T) {
	setValidEnv(t)
	os.Unsetenv("AGENT_HMAC_SECRET")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("missing HMAC secret must fail config load")
	}
}

func TestLoadConfigShortSecret(t *testing.T) {
	setValidEnv(t)
	t.Setenv("AGENT_HMAC_SECRET", "too-short")
	if _, err := LoadConfig(); err == nil {
		t.Fatal("short HMAC secret must fail config load")
	}
}

func TestLoadConfigLegacySecretName(t *testing.T) {
	setValidEnv(t)
	os.Unsetenv("AGENT_HMAC_SECRET")
	t.Setenv("VEIL_HMAC_SECRET", "test-secret-0123456789abcdef-32ch")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("legacy VEIL_HMAC_SECRET should be accepted: %v", err)
	}
	if string(cfg.HMACSecret) != "test-secret-0123456789abcdef-32ch" {
		t.Fatal("legacy secret value not picked up")
	}
}

func TestLoadConfigPrevSecret(t *testing.T) {
	setValidEnv(t)
	t.Setenv("AGENT_HMAC_SECRET_PREV", "prev-secret-0123456789abcdef-32ch")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("prev secret rejected: %v", err)
	}
	if string(cfg.HMACSecretPrev) != "prev-secret-0123456789abcdef-32ch" {
		t.Fatal("prev secret value not picked up")
	}
}

func TestLoadConfigInvalidValues(t *testing.T) {
	cases := []struct {
		name  string
		setup func(t *testing.T)
	}{
		{"bad port", func(t *testing.T) { t.Setenv("AGENT_PORT", "99999") }},
		{"non-numeric port", func(t *testing.T) { t.Setenv("AGENT_PORT", "https") }},
		{"bad interface", func(t *testing.T) { t.Setenv("WG_INTERFACE", "eth0;rm -rf /") }},
		{"interface too long", func(t *testing.T) { t.Setenv("WG_INTERFACE", "0123456789abcdef") }},
		{"bad cidr", func(t *testing.T) { t.Setenv("IP_POOL_CIDR", "not-a-cidr") }},
		{"ipv6 pool", func(t *testing.T) { t.Setenv("IP_POOL_CIDR", "fd00::/64") }},
		{"sync too small", func(t *testing.T) { t.Setenv("PEER_SYNC_INTERVAL_SECONDS", "1") }},
		{"missing cert", func(t *testing.T) { t.Setenv("AGENT_TLS_CERT", "/nonexistent/cert.pem") }},
		{"short prev secret", func(t *testing.T) { t.Setenv("AGENT_HMAC_SECRET_PREV", "short") }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			setValidEnv(t)
			c.setup(t)
			if _, err := LoadConfig(); err == nil {
				t.Fatalf("%s: invalid config was accepted", c.name)
			}
		})
	}
}

func TestLoadConfigDebugFlags(t *testing.T) {
	setValidEnv(t)
	t.Setenv("AGENT_DEBUG", "1")
	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Debug {
		t.Fatal("AGENT_DEBUG=1 should enable debug")
	}
}
