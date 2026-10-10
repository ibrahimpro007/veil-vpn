package main

// Tests for peer input validation.

import (
	"crypto/rand"
	"encoding/base64"
	"net"
	"strings"
	"testing"
)

func testPool(t *testing.T) (*net.IPNet, net.IP) {
	t.Helper()
	_, pool, err := net.ParseCIDR("10.7.0.0/24")
	if err != nil {
		t.Fatal(err)
	}
	return pool, firstUsableIP(pool)
}

// randomKey returns a valid 44-char base64 WireGuard public key.
func randomKey(t *testing.T) string {
	t.Helper()
	var raw [32]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatal(err)
	}
	return base64.StdEncoding.EncodeToString(raw[:])
}

// trickyKey returns a valid key whose base64 contains + / and = so URL
// encoding paths get exercised.
func trickyKey(t *testing.T) string {
	t.Helper()
	for i := 0; i < 10000; i++ {
		k := randomKey(t)
		if strings.Contains(k, "+") && strings.Contains(k, "/") {
			return k
		}
	}
	t.Fatal("could not generate key with + and /")
	return ""
}

func TestValidatePublicKeyOK(t *testing.T) {
	raw, err := validatePublicKey(randomKey(t))
	if err != nil {
		t.Fatalf("valid key rejected: %v", err)
	}
	if len(raw) != 32 {
		t.Fatalf("expected 32 bytes, got %d", len(raw))
	}
}

func TestValidatePublicKeyRejects(t *testing.T) {
	cases := map[string]string{
		"empty":          "",
		"too short":      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",   // 43
		"too long":       "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 45
		"bad chars":      "!!!!" + strings.Repeat("A", 40),
		"urlsafe base64": strings.Repeat("A", 42) + "--", // '-' not in StdEncoding
		"wrong length":   base64.StdEncoding.EncodeToString(make([]byte, 31)),
	}
	for name, key := range cases {
		if _, err := validatePublicKey(key); err == nil {
			t.Errorf("%s: invalid key %q was accepted", name, key)
		}
	}
}

func TestValidateTunnelIP(t *testing.T) {
	pool, gw := testPool(t)
	ok := []string{"10.7.0.2", "10.7.0.100", "10.7.0.254"}
	for _, ip := range ok {
		if _, err := validateTunnelIP(ip, pool, gw); err != nil {
			t.Errorf("valid IP %s rejected: %v", ip, err)
		}
	}
	bad := map[string]string{
		"network address":   "10.7.0.0",
		"broadcast address": "10.7.0.255",
		"gateway address":   "10.7.0.1",
		"outside pool":      "10.8.0.5",
		"not an ip":         "not-an-ip",
		"empty":             "",
		"ipv6":              "::1",
	}
	for name, ip := range bad {
		if _, err := validateTunnelIP(ip, pool, gw); err == nil {
			t.Errorf("%s: invalid IP %q was accepted", name, ip)
		}
	}
	// Note: ::ffff:10.7.0.5 parses via To4(); it IS inside the pool as an
	// IPv4-mapped address and therefore accepted as the IPv4 10.7.0.5. That
	// case is intentionally not in the reject list — the check above asserts
	// the current behavior explicitly.
	if _, err := validateTunnelIP("::ffff:10.7.0.5", pool, gw); err != nil {
		t.Errorf("ipv4-mapped address should normalize to 10.7.0.5: %v", err)
	}
}

func TestValidateDNSIP(t *testing.T) {
	for _, dns := range []string{"", "10.7.0.1", "1.1.1.1", "  9.9.9.9  "} {
		if err := validateDNSIP(dns); err != nil {
			t.Errorf("valid dns %q rejected: %v", dns, err)
		}
	}
	for _, dns := range []string{"nope", "999.1.1.1", "::1"} {
		if err := validateDNSIP(dns); err == nil {
			t.Errorf("invalid dns %q was accepted", dns)
		}
	}
}
