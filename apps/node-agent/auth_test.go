package main

// Tests for the HMAC authentication middleware.

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

const (
	testSecret     = "test-secret-0123456789abcdef-32ch" // >= 32 chars
	testSecretPrev = "prev-secret-0123456789abcdef-32ch"
)

func testAuthNow() time.Time { return time.Unix(1_800_000_000, 0) }

func newTestAuth(secret, prev string) *hmacAuth {
	cfg := &Config{HMACSecret: []byte(secret), HMACSecretPrev: []byte(prev)}
	a := newHMACAuth(cfg, NewLogger(io.Discard, false))
	a.now = testAuthNow
	return a
}

// signedRequest builds a request with correct X-Veil-* headers.
func signedRequest(t *testing.T, secret, method, target, body string, ts time.Time) *http.Request {
	t.Helper()
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	req := httptest.NewRequest(method, target, reader)
	timestamp := strconv.FormatInt(ts.Unix(), 10)
	sig := SignRequest([]byte(secret), timestamp, method, req.URL.RequestURI(), []byte(body))
	req.Header.Set(headerTimestamp, timestamp)
	req.Header.Set(headerSignature, sig)
	return req
}

func authed(t *testing.T, a *hmacAuth, req *http.Request) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// prove the body was restored for downstream handlers
		body, _ := io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(body)
	})
	a.Middleware(next).ServeHTTP(rec, req)
	return rec
}

func TestAuthValid(t *testing.T) {
	a := newTestAuth(testSecret, "")
	rec := authed(t, a, signedRequest(t, testSecret, "POST", "/peers", `{"a":1}`, testAuthNow()))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if rec.Body.String() != `{"a":1}` {
		t.Fatalf("downstream handler did not see restored body: %q", rec.Body.String())
	}
}

func TestAuthValidEmptyBody(t *testing.T) {
	a := newTestAuth(testSecret, "")
	rec := authed(t, a, signedRequest(t, testSecret, "GET", "/health", "", testAuthNow()))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}

func TestAuthBadSecret(t *testing.T) {
	a := newTestAuth(testSecret, "")
	rec := authed(t, a, signedRequest(t, "wrong-secret-0123456789abcdef-32", "GET", "/health", "", testAuthNow()))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "auth_bad_signature") {
		t.Fatalf("expected auth_bad_signature, got %s", rec.Body.String())
	}
}

func TestAuthPrevSecretRotation(t *testing.T) {
	a := newTestAuth(testSecret, testSecretPrev)
	// Signed with the PREVIOUS secret: accepted during rotation.
	rec := authed(t, a, signedRequest(t, testSecretPrev, "GET", "/metrics", "", testAuthNow()))
	if rec.Code != http.StatusOK {
		t.Fatalf("prev secret should be accepted during rotation, got %d: %s", rec.Code, rec.Body.String())
	}
	// Signed with the current secret: still accepted.
	rec = authed(t, a, signedRequest(t, testSecret, "GET", "/metrics", "", testAuthNow()))
	if rec.Code != http.StatusOK {
		t.Fatalf("current secret should be accepted, got %d", rec.Code)
	}
}

func TestAuthSkewedTimestamp(t *testing.T) {
	a := newTestAuth(testSecret, "")
	old := testAuthNow().Add(-301 * time.Second)
	rec := authed(t, a, signedRequest(t, testSecret, "GET", "/health", "", old))
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "auth_stale_timestamp") {
		t.Fatalf("stale timestamp should be rejected: %d %s", rec.Code, rec.Body.String())
	}
	future := testAuthNow().Add(301 * time.Second)
	rec = authed(t, a, signedRequest(t, testSecret, "GET", "/health", "", future))
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "auth_stale_timestamp") {
		t.Fatalf("future timestamp should be rejected: %d %s", rec.Code, rec.Body.String())
	}
	// Boundary: exactly 300s is allowed.
	edge := testAuthNow().Add(-300 * time.Second)
	rec = authed(t, a, signedRequest(t, testSecret, "GET", "/health", "", edge))
	if rec.Code != http.StatusOK {
		t.Fatalf("300s skew should be allowed, got %d", rec.Code)
	}
}

func TestAuthReplayRejected(t *testing.T) {
	a := newTestAuth(testSecret, "")
	req := signedRequest(t, testSecret, "POST", "/peers", `{"a":1}`, testAuthNow())
	if rec := authed(t, a, req); rec.Code != http.StatusOK {
		t.Fatalf("first request should pass, got %d", rec.Code)
	}
	// Exact replay of the same signed request must fail.
	replay := signedRequest(t, testSecret, "POST", "/peers", `{"a":1}`, testAuthNow())
	if rec := authed(t, a, replay); rec.Code != http.StatusUnauthorized ||
		!strings.Contains(rec.Body.String(), "auth_replay") {
		t.Fatalf("replay should be rejected: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuthSameTimestampDifferentRequestAllowed(t *testing.T) {
	a := newTestAuth(testSecret, "")
	// Two DISTINCT requests sharing one timestamp must both pass: replay
	// protection is keyed on timestamp+signature, not the bare timestamp.
	r1 := authed(t, a, signedRequest(t, testSecret, "POST", "/peers", `{"a":1}`, testAuthNow()))
	r2 := authed(t, a, signedRequest(t, testSecret, "POST", "/peers", `{"a":2}`, testAuthNow()))
	if r1.Code != http.StatusOK || r2.Code != http.StatusOK {
		t.Fatalf("distinct requests in the same second must both pass: %d %d", r1.Code, r2.Code)
	}
}

func TestAuthMissingHeaders(t *testing.T) {
	a := newTestAuth(testSecret, "")
	req := httptest.NewRequest("GET", "/health", nil)
	rec := authed(t, a, req)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "auth_missing") {
		t.Fatalf("missing headers should be rejected: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuthMalformedTimestamp(t *testing.T) {
	a := newTestAuth(testSecret, "")
	req := httptest.NewRequest("GET", "/health", nil)
	req.Header.Set(headerTimestamp, "not-a-number")
	req.Header.Set(headerSignature, "abcd")
	rec := authed(t, a, req)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "auth_bad_timestamp") {
		t.Fatalf("malformed timestamp should be rejected: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuthTamperedBody(t *testing.T) {
	a := newTestAuth(testSecret, "")
	req := signedRequest(t, testSecret, "POST", "/peers", `{"a":1}`, testAuthNow())
	// Tamper after signing: signature must no longer verify.
	req.Body = io.NopCloser(strings.NewReader(`{"a":2}`))
	req.ContentLength = int64(len(`{"a":2}`))
	rec := authed(t, a, req)
	if rec.Code != http.StatusUnauthorized || !strings.Contains(rec.Body.String(), "auth_bad_signature") {
		t.Fatalf("tampered body should be rejected: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuthQueryStringIsPartOfPath(t *testing.T) {
	a := newTestAuth(testSecret, "")
	// Signed WITH query string: passes when the query is present...
	rec := authed(t, a, signedRequest(t, testSecret, "GET", "/peers?x=1", "", testAuthNow()))
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	// ...but a signature computed without the query must fail for the same URL.
	plain := httptest.NewRequest("GET", "/peers?x=1", nil)
	ts := strconv.FormatInt(testAuthNow().Unix(), 10)
	plain.Header.Set(headerTimestamp, ts)
	plain.Header.Set(headerSignature, SignRequest([]byte(testSecret), ts, "GET", "/peers", nil))
	rec = authed(t, a, plain)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("signature over wrong path should be rejected, got %d", rec.Code)
	}
}
