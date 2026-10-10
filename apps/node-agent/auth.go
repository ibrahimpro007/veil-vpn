package main

// HMAC authentication middleware.
//
// Implements the Phase 1 contract (PHASE1_NOTES.md) exactly:
//  1. bodyHash = sha256_hex(raw request body)  (empty body -> sha256 of "")
//  2. message   = "<timestamp>.<method>.<path>.<bodyHash>"
//     <timestamp>: Unix epoch seconds, ASCII
//     <method>:    uppercase, e.g. POST
//     <path>:      path + query string as sent (r.URL.RequestURI())
//  3. signature = HMAC_SHA256_hex(key, message)
//  4. headers: X-Veil-Signature, X-Veil-Timestamp
//  5. verifier rejects |now - timestamp| > 300s, constant-time compare.
//
// Extensions required by the Phase 4 spec:
//   - Replay protection: an in-memory LRU (10k entries) of seen requests.
//     Entries are keyed by timestamp+signature so that two distinct legitimate
//     requests issued within the same second are NOT rejected, while an exact
//     replay of a signed request always is. (Keying on the bare timestamp
//     would falsely reject concurrent legitimate requests.)
//   - Secret rotation: AGENT_HMAC_SECRET_PREV is accepted while a new secret
//     is being rolled out; see README.md "Key rotation".

import (
	"bytes"
	"container/list"
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	headerSignature = "X-Veil-Signature"
	headerTimestamp = "X-Veil-Timestamp"
	replayCacheSize = 10000
)

// SignRequest computes the X-Veil-Signature value for the given request
// components. Exported for tests and for documentation of the scheme.
func SignRequest(secret []byte, timestamp, method, path string, body []byte) string {
	bodyHash := sha256.Sum256(body)
	msg := strings.Join([]string{timestamp, strings.ToUpper(method), path, hex.EncodeToString(bodyHash[:])}, ".")
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(msg))
	return hex.EncodeToString(mac.Sum(nil))
}

// replayCache is a bounded LRU of seen (timestamp, signature) pairs used to
// reject replayed requests. Entries expire after the skew window.
type replayCache struct {
	mu  sync.Mutex
	ll  *list.List // front = most recent; elements are *replayEntry
	m   map[string]*list.Element
	max int
}

type replayEntry struct {
	key     string
	expires int64 // Unix seconds; entry is useless after this
}

func newReplayCache(max int) *replayCache {
	return &replayCache{ll: list.New(), m: make(map[string]*list.Element), max: max}
}

// seen reports whether key was already recorded (and not yet expired).
func (c *replayCache) seen(key string, now int64) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.m[key]
	if !ok {
		return false
	}
	e := el.Value.(*replayEntry)
	if e.expires <= now {
		c.ll.Remove(el)
		delete(c.m, key)
		return false
	}
	c.ll.MoveToFront(el)
	return true
}

// add records key, evicting the least-recently-used entries beyond capacity
// and opportunistically dropping expired ones.
func (c *replayCache) add(key string, expires, now int64) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.m[key]; ok {
		c.ll.MoveToFront(el)
		el.Value.(*replayEntry).expires = expires
		return
	}
	// Opportunistic expiry sweep (bounded: only from the back).
	for c.ll.Len() > 0 {
		back := c.ll.Back().Value.(*replayEntry)
		if back.expires > now {
			break
		}
		delete(c.m, back.key)
		c.ll.Remove(c.ll.Back())
	}
	for c.ll.Len() >= c.max {
		back := c.ll.Back().Value.(*replayEntry)
		delete(c.m, back.key)
		c.ll.Remove(c.ll.Back())
	}
	c.m[key] = c.ll.PushFront(&replayEntry{key: key, expires: expires})
}

// verifySignature checks the HMAC-SHA256 signature against the current and
// (during rotation) previous secret using constant-time comparison.
func verifySignature(secrets [][]byte, sigHex, timestamp, method, path string, body []byte) bool {
	sig, err := hex.DecodeString(strings.TrimSpace(sigHex))
	if err != nil || len(sig) != sha256.Size {
		return false
	}
	bodyHash := sha256.Sum256(body)
	msg := strings.Join([]string{timestamp, strings.ToUpper(method), path, hex.EncodeToString(bodyHash[:])}, ".")
	for _, secret := range secrets {
		if len(secret) == 0 {
			continue
		}
		mac := hmac.New(sha256.New, secret)
		_, _ = mac.Write([]byte(msg))
		expected := mac.Sum(nil)
		if subtle.ConstantTimeCompare(expected, sig) == 1 {
			return true
		}
	}
	return false
}

// hmacAuth is HTTP middleware enforcing the Veil HMAC scheme on every route.
type hmacAuth struct {
	secrets []byte
	prev    []byte
	replay  *replayCache
	log     *Logger
	now     func() time.Time // overridable in tests
}

func newHMACAuth(cfg *Config, log *Logger) *hmacAuth {
	return &hmacAuth{
		secrets: cfg.HMACSecret,
		prev:    cfg.HMACSecretPrev,
		replay:  newReplayCache(replayCacheSize),
		log:     log,
		now:     time.Now,
	}
}

func (a *hmacAuth) secretsList() [][]byte {
	if len(a.prev) > 0 {
		return [][]byte{a.secrets, a.prev}
	}
	return [][]byte{a.secrets}
}

// Middleware wraps next with HMAC verification.
func (a *hmacAuth) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqID := requestIDFrom(r.Context())

		if r.ContentLength > maxRequestBody {
			writeAPIError(w, http.StatusRequestEntityTooLarge, "body_too_large", "request body exceeds 1 MiB", reqID)
			return
		}
		body, err := io.ReadAll(io.LimitReader(r.Body, maxRequestBody+1))
		_ = r.Body.Close()
		if err != nil {
			writeAPIError(w, http.StatusBadRequest, "body_read_error", "could not read request body", reqID)
			return
		}
		if int64(len(body)) > maxRequestBody {
			writeAPIError(w, http.StatusRequestEntityTooLarge, "body_too_large", "request body exceeds 1 MiB", reqID)
			return
		}
		// Restore the body for downstream handlers.
		r.Body = io.NopCloser(bytes.NewReader(body))

		tsStr := strings.TrimSpace(r.Header.Get(headerTimestamp))
		sigHex := strings.TrimSpace(r.Header.Get(headerSignature))
		if tsStr == "" || sigHex == "" {
			a.log.Warn("auth rejected: missing signature headers", map[string]any{"request_id": reqID})
			writeAPIError(w, http.StatusUnauthorized, "auth_missing", "missing X-Veil-Signature / X-Veil-Timestamp", reqID)
			return
		}
		ts, err := strconv.ParseInt(tsStr, 10, 64)
		if err != nil || ts <= 0 {
			a.log.Warn("auth rejected: malformed timestamp", map[string]any{"request_id": reqID})
			writeAPIError(w, http.StatusUnauthorized, "auth_bad_timestamp", "X-Veil-Timestamp must be Unix epoch seconds", reqID)
			return
		}
		now := a.now().Unix()
		if skew := now - ts; skew > maxSkewSeconds || skew < -maxSkewSeconds {
			a.log.Warn("auth rejected: timestamp skew", map[string]any{"request_id": reqID, "skew_sec": skew})
			writeAPIError(w, http.StatusUnauthorized, "auth_stale_timestamp", "timestamp outside 5-minute skew window", reqID)
			return
		}
		if !verifySignature(a.secretsList(), sigHex, tsStr, r.Method, r.URL.RequestURI(), body) {
			a.log.Warn("auth rejected: bad signature", map[string]any{"request_id": reqID})
			writeAPIError(w, http.StatusUnauthorized, "auth_bad_signature", "signature verification failed", reqID)
			return
		}
		replayKey := tsStr + "|" + strings.ToLower(sigHex)
		if a.replay.seen(replayKey, now) {
			a.log.Warn("auth rejected: replayed request", map[string]any{"request_id": reqID})
			writeAPIError(w, http.StatusUnauthorized, "auth_replay", "request was already processed", reqID)
			return
		}
		a.replay.add(replayKey, ts+maxSkewSeconds, now)

		next.ServeHTTP(w, r)
	})
}
