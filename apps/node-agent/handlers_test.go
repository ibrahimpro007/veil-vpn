package main

// End-to-end handler tests through the real middleware stack, with a fake
// WireGuard runner (no kernel, no wg binary needed).

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// fakeWG is an in-memory WGRunner for tests.
type fakeWG struct {
	peers      map[string]string // publicKey -> allowed IP (without /32)
	failSet    bool
	failRemove bool
	failList   bool
	setCalls   int
}

func newFakeWG() *fakeWG { return &fakeWG{peers: map[string]string{}} }

func (f *fakeWG) SetPeer(_ context.Context, _, publicKeyB64 string, allowedIPs []string) error {
	f.setCalls++
	if f.failSet {
		return errors.New("simulated wg failure")
	}
	f.peers[publicKeyB64] = strings.TrimSuffix(allowedIPs[0], "/32")
	return nil
}

func (f *fakeWG) RemovePeer(_ context.Context, _, publicKeyB64 string) error {
	if f.failRemove {
		return errors.New("simulated wg failure")
	}
	if _, ok := f.peers[publicKeyB64]; !ok {
		return errors.New("peer not found")
	}
	delete(f.peers, publicKeyB64)
	return nil
}

func (f *fakeWG) ListPeers(_ context.Context, _ string) ([]string, error) {
	if f.failList {
		return nil, errors.New("simulated wg failure")
	}
	var out []string
	for k := range f.peers {
		out = append(out, k)
	}
	return out, nil
}

// testStack builds the exact middleware chain main() uses.
func testStack(t *testing.T, srv *Server) http.Handler {
	t.Helper()
	auth := newHMACAuth(srv.cfg, srv.log)
	auth.now = testAuthNow
	mux := http.NewServeMux()
	mux.Handle("POST /peers", auth.Middleware(http.HandlerFunc(srv.handleAddPeer)))
	mux.Handle("DELETE /peers/{pubkey}", auth.Middleware(http.HandlerFunc(srv.handleRemovePeer)))
	mux.Handle("GET /health", auth.Middleware(http.HandlerFunc(srv.handleHealth)))
	mux.Handle("GET /metrics", auth.Middleware(http.HandlerFunc(srv.handleMetrics)))
	return requestIDMiddleware(mux)
}

func newTestServer(t *testing.T, wg *fakeWG) *Server {
	t.Helper()
	_, pool, _ := net.ParseCIDR("10.7.0.0/24")
	dir := t.TempDir()
	cfg := &Config{
		Bind:         "127.0.0.1",
		Port:         8443,
		HMACSecret:   []byte(testSecret),
		WGInterface:  "wg0",
		Pool:         pool,
		GatewayIP:    firstUsableIP(pool),
		SyncInterval: time.Minute,
		StateDir:     dir,
		StateFile:    dir + "/peers.json",
	}
	state, err := LoadPeerState(cfg.StateFile)
	if err != nil {
		t.Fatal(err)
	}
	return &Server{cfg: cfg, log: NewLogger(io.Discard, false), state: state, wg: wg, startTime: time.Now(), version: "test"}
}

// doSigned performs a signed request against the stack with the test clock.
func doSigned(t *testing.T, h http.Handler, method, target, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := signedRequest(t, testSecret, method, target, body, testAuthNow())
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestAddPeerOK(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	key := randomKey(t)
	rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+key+`","assignedIp":"10.7.0.42","dns":"10.7.0.1"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || body["ok"] != true {
		t.Fatalf("expected {ok:true}, got %s", rec.Body.String())
	}
	if fake.peers[key] != "10.7.0.42" {
		t.Fatalf("peer not applied to wg: %+v", fake.peers)
	}
	if !srv.state.Has(key) {
		t.Fatal("peer not persisted in desired state")
	}
	if rec.Header().Get("X-Request-Id") == "" {
		t.Fatal("missing X-Request-Id on success")
	}
}

func TestAddPeerValidation(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	cases := []struct {
		name string
		body string
		code string // expected error code
	}{
		{"bad key", `{"publicKey":"nope","assignedIp":"10.7.0.5"}`, "invalid_peer"},
		{"gateway ip", `{"publicKey":"` + randomKey(t) + `","assignedIp":"10.7.0.1"}`, "invalid_peer"},
		{"outside pool", `{"publicKey":"` + randomKey(t) + `","assignedIp":"192.168.1.5"}`, "invalid_peer"},
		{"bad dns", `{"publicKey":"` + randomKey(t) + `","assignedIp":"10.7.0.6","dns":"nope"}`, "invalid_peer"},
		{"not json", `{oops`, "invalid_json"},
		{"unknown field", `{"publicKey":"` + randomKey(t) + `","assignedIp":"10.7.0.7","zzz":1}`, "invalid_json"},
	}
	for _, c := range cases {
		rec := doSigned(t, h, "POST", "/peers", c.body)
		if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), c.code) {
			t.Errorf("%s: expected 400/%s, got %d %s", c.name, c.code, rec.Code, rec.Body.String())
		}
	}
}

func TestAddPeerIPConflict(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	k1, k2 := randomKey(t), randomKey(t)
	if rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+k1+`","assignedIp":"10.7.0.50"}`); rec.Code != 200 {
		t.Fatalf("first add failed: %d", rec.Code)
	}
	rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+k2+`","assignedIp":"10.7.0.50"}`)
	if rec.Code != http.StatusConflict || !strings.Contains(rec.Body.String(), "ip_in_use") {
		t.Fatalf("expected 409 ip_in_use, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestAddPeerWgFailureIs502(t *testing.T) {
	fake := newFakeWG()
	fake.failSet = true
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	key := randomKey(t)
	rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+key+`","assignedIp":"10.7.0.60"}`)
	if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), "wireguard_error") {
		t.Fatalf("expected 502 wireguard_error, got %d %s", rec.Code, rec.Body.String())
	}
	// Desired state was still saved: the reconciler will retry the wg call.
	if !srv.state.Has(key) {
		t.Fatal("desired state should be saved even when wg fails (reconciler retries)")
	}
}

func TestRemovePeerOK(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	// Use a key with + / = so URL-encoding is exercised end to end.
	key := trickyKey(t)
	if rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+key+`","assignedIp":"10.7.0.70"}`); rec.Code != 200 {
		t.Fatalf("add failed: %d %s", rec.Code, rec.Body.String())
	}
	escaped := url.PathEscape(key)
	rec := doSigned(t, h, "DELETE", "/peers/"+escaped, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if _, ok := fake.peers[key]; ok {
		t.Fatal("peer still present in wg after delete")
	}
	if srv.state.Has(key) {
		t.Fatal("peer still present in desired state after delete")
	}
}

func TestRemovePeerNotFound(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	rec := doSigned(t, h, "DELETE", "/peers/"+url.PathEscape(randomKey(t)), "")
	if rec.Code != http.StatusNotFound || !strings.Contains(rec.Body.String(), "peer_not_found") {
		t.Fatalf("expected 404 peer_not_found, got %d %s", rec.Code, rec.Body.String())
	}
}

func TestRemovePeerWgFailureIs502(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	key := randomKey(t)
	if rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+key+`","assignedIp":"10.7.0.80"}`); rec.Code != 200 {
		t.Fatalf("add failed: %d", rec.Code)
	}
	fake.failRemove = true
	rec := doSigned(t, h, "DELETE", "/peers/"+url.PathEscape(key), "")
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d %s", rec.Code, rec.Body.String())
	}
	if !srv.state.Has(key) {
		t.Fatal("peer must stay in desired state when wg removal fails")
	}
}

func TestHealthAndMetrics(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	key := randomKey(t)
	if rec := doSigned(t, h, "POST", "/peers", `{"publicKey":"`+key+`","assignedIp":"10.7.0.90"}`); rec.Code != 200 {
		t.Fatalf("add failed: %d", rec.Code)
	}

	rec := doSigned(t, h, "GET", "/health", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("health: expected 200, got %d", rec.Code)
	}
	var health map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &health); err != nil {
		t.Fatal(err)
	}
	for _, f := range []string{"ok", "interface", "peerCount", "uptimeSec", "version"} {
		if _, ok := health[f]; !ok {
			t.Errorf("health missing field %q", f)
		}
	}
	if health["peerCount"] != float64(1) || health["interface"] != "wg0" || health["version"] != "test" {
		t.Errorf("unexpected health body: %v", health)
	}

	rec = doSigned(t, h, "GET", "/metrics", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("metrics: expected 200, got %d", rec.Code)
	}
	var metrics map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &metrics); err != nil {
		t.Fatal(err)
	}
	// Aggregate only: exactly these four keys, nothing per-peer.
	want := map[string]bool{"peerCount": true, "uptimeSec": true, "version": true, "interface": true}
	if len(metrics) != len(want) {
		t.Fatalf("metrics must expose exactly %v, got %v", want, metrics)
	}
	for k := range metrics {
		if !want[k] {
			t.Fatalf("metrics leaked unexpected field %q", k)
		}
	}
	// The peer key must not appear anywhere in the metrics body.
	if strings.Contains(rec.Body.String(), key) {
		t.Fatal("metrics body contains a peer key: privacy violation")
	}
}

func TestUnauthenticatedIsRejected(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)
	h := testStack(t, srv)

	for _, target := range []struct{ method, path string }{
		{"GET", "/health"}, {"GET", "/metrics"},
		{"POST", "/peers"}, {"DELETE", "/peers/" + url.PathEscape(randomKey(t))},
	} {
		req := httptest.NewRequest(target.method, target.path, nil)
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s %s: expected 401 without auth, got %d", target.method, target.path, rec.Code)
		}
		if !strings.Contains(rec.Body.String(), "requestId") {
			t.Errorf("%s %s: error body missing requestId", target.method, target.path)
		}
	}
}

func TestReconcileOnceWithFake(t *testing.T) {
	fake := newFakeWG()
	srv := newTestServer(t, fake)

	// Desired has "wanted" (missing from wg) and wg has "rogue" (not desired).
	wanted := randomKey(t)
	rogue := randomKey(t)
	if err := srv.state.Set(wanted, PeerRecord{AssignedIP: "10.7.0.11", AddedAt: 1}); err != nil {
		t.Fatal(err)
	}
	fake.peers[rogue] = "10.7.0.12"

	srv.reconcileOnce(context.Background())

	if fake.peers[wanted] != "10.7.0.11" {
		t.Fatalf("reconciler did not add missing peer: %+v", fake.peers)
	}
	if _, ok := fake.peers[rogue]; ok {
		t.Fatalf("reconciler did not remove rogue peer: %+v", fake.peers)
	}
	if fake.setCalls != 1 {
		t.Fatalf("expected exactly 1 wg set call, got %d", fake.setCalls)
	}
}

func TestReconcileOnceListFailureIsFailClosed(t *testing.T) {
	fake := newFakeWG()
	fake.failList = true
	srv := newTestServer(t, fake)

	wanted := randomKey(t)
	if err := srv.state.Set(wanted, PeerRecord{AssignedIP: "10.7.0.13", AddedAt: 1}); err != nil {
		t.Fatal(err)
	}
	srv.reconcileOnce(context.Background())
	if fake.setCalls != 0 {
		t.Fatal("reconciler must not change anything when it cannot list peers")
	}
}
