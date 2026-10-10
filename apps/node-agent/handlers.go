package main

// HTTP handlers for the node-agent control API.
//
// Every route is HMAC-authenticated (see auth.go); there is no unauthenticated
// endpoint. Error bodies follow the Phase 1 ApiError shape:
// {"error":{"code":...,"message":...},"requestId":...}, and every response
// carries X-Request-Id.

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

type ctxKey string

const requestIDKey ctxKey = "request_id"

// apiError writes a Phase-1-shaped ApiError body.
func writeAPIError(w http.ResponseWriter, status int, code, message, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-Id", requestID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"error":     map[string]string{"code": code, "message": message},
		"requestId": requestID,
	})
}

func writeJSON(w http.ResponseWriter, status int, v any, requestID string) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("X-Request-Id", requestID)
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func requestIDFrom(ctx context.Context) string {
	if v, ok := ctx.Value(requestIDKey).(string); ok && v != "" {
		return v
	}
	return "unknown"
}

// newRequestID returns a random v4 UUID (hex with dashes), stdlib only.
func newRequestID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("fallback-%d", time.Now().UnixNano())
	}
	b[6] = (b[6] & 0x0f) | 0x40 // version 4
	b[8] = (b[8] & 0x3f) | 0x80 // variant 10
	h := hex.EncodeToString(b[:])
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

// requestIDMiddleware assigns X-Request-Id to every request/response.
func requestIDMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := newRequestID()
		r = r.WithContext(context.WithValue(r.Context(), requestIDKey, id))
		w.Header().Set("X-Request-Id", id)
		next.ServeHTTP(w, r)
	})
}

// --- input validation -------------------------------------------------

// validatePublicKey strictly validates a WireGuard public key in base64 form:
// exactly 44 chars, valid standard base64, decoding to exactly 32 bytes.
func validatePublicKey(s string) ([]byte, error) {
	if len(s) != 44 {
		return nil, fmt.Errorf("publicKey must be 44 base64 characters, got %d", len(s))
	}
	raw, err := base64.StdEncoding.DecodeString(s)
	if err != nil {
		return nil, fmt.Errorf("publicKey is not valid base64: %v", err)
	}
	if len(raw) != 32 {
		return nil, fmt.Errorf("publicKey must decode to 32 bytes, got %d", len(raw))
	}
	return raw, nil
}

// validateTunnelIP checks that ipStr is an IPv4 address inside the pool and
// not a reserved address (network, broadcast, or gateway/DNS address).
func validateTunnelIP(ipStr string, pool *net.IPNet, gateway net.IP) (net.IP, error) {
	ip := net.ParseIP(strings.TrimSpace(ipStr))
	if ip == nil {
		return nil, fmt.Errorf("assignedIp %q is not a valid IP address", ipStr)
	}
	ip4 := ip.To4()
	if ip4 == nil {
		return nil, fmt.Errorf("assignedIp %q must be IPv4", ipStr)
	}
	if !pool.Contains(ip4) {
		return nil, fmt.Errorf("assignedIp %q is not inside pool %s", ipStr, pool.String())
	}
	if ip4.Equal(pool.IP.To4()) {
		return nil, fmt.Errorf("assignedIp %q is the pool network address (reserved)", ipStr)
	}
	if ip4.Equal(broadcastIP(pool)) {
		return nil, fmt.Errorf("assignedIp %q is the pool broadcast address (reserved)", ipStr)
	}
	if ip4.Equal(gateway.To4()) {
		return nil, fmt.Errorf("assignedIp %q is the pool gateway/DNS address (reserved)", ipStr)
	}
	return ip4, nil
}

// validateDNSIP checks an optional DNS override: empty is allowed, otherwise
// it must be a valid IPv4 address.
func validateDNSIP(dns string) error {
	if strings.TrimSpace(dns) == "" {
		return nil
	}
	if ip := net.ParseIP(strings.TrimSpace(dns)); ip == nil || ip.To4() == nil {
		return fmt.Errorf("dns %q must be a valid IPv4 address", dns)
	}
	return nil
}

// --- handlers ----------------------------------------------------------

type addPeerRequest struct {
	PublicKey  string `json:"publicKey"`
	AssignedIP string `json:"assignedIp"`
	DNS        string `json:"dns,omitempty"`
}

// handleAddPeer implements POST /peers.
func (s *Server) handleAddPeer(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r.Context())
	if r.Method != http.MethodPost {
		writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "use POST", reqID)
		return
	}
	var req addPeerRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_json", "request body must be JSON {publicKey, assignedIp, dns?}: "+firstLine(err.Error()), reqID)
		return
	}
	if _, err := validatePublicKey(req.PublicKey); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_peer", err.Error(), reqID)
		return
	}
	ip4, err := validateTunnelIP(req.AssignedIP, s.cfg.Pool, s.cfg.GatewayIP)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_peer", err.Error(), reqID)
		return
	}
	if err := validateDNSIP(req.DNS); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_peer", err.Error(), reqID)
		return
	}
	// Refuse to hand the same tunnel IP to two different keys.
	for key, rec := range s.state.Snapshot() {
		if key != req.PublicKey && rec.AssignedIP == ip4.String() {
			writeAPIError(w, http.StatusConflict, "ip_in_use", "assignedIp is already allocated to another peer", reqID)
			return
		}
	}

	// Persist desired state FIRST so a crash between state and WireGuard is
	// healed by the reconciler (it will add the missing peer on next pass).
	now := time.Now().Unix()
	if err := s.state.Set(req.PublicKey, PeerRecord{
		AssignedIP: ip4.String(),
		DNS:        strings.TrimSpace(req.DNS),
		AddedAt:    now,
	}); err != nil {
		s.log.Error("failed to persist peer state", map[string]any{"request_id": reqID, "error": err.Error()})
		writeAPIError(w, http.StatusInternalServerError, "state_error", "could not persist desired state", reqID)
		return
	}
	if err := s.wg.SetPeer(r.Context(), s.cfg.WGInterface, req.PublicKey, []string{ip4.String() + "/32"}); err != nil {
		// Desired state already records the peer; the reconciler will retry
		// the wg(8) call until it succeeds.
		s.log.Error("wg set peer failed; reconciler will retry", map[string]any{"request_id": reqID, "error": err.Error()})
		writeAPIError(w, http.StatusBadGateway, "wireguard_error", "wg failed to apply peer (desired state saved; retry pending): "+firstLine(err.Error()), reqID)
		return
	}
	s.log.Info("peer added", map[string]any{"request_id": reqID, "peer_count": s.state.Count()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "appliedAt": now}, reqID)
}

// handleRemovePeer implements DELETE /peers/{pubkey}. The key is base64 and
// must be URL-encoded by the client (it may contain + / =).
func (s *Server) handleRemovePeer(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r.Context())
	if r.Method != http.MethodDelete {
		writeAPIError(w, http.StatusMethodNotAllowed, "method_not_allowed", "use DELETE", reqID)
		return
	}
	raw := r.PathValue("pubkey")
	key, err := url.PathUnescape(raw)
	if err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_peer", "publicKey is not valid URL encoding", reqID)
		return
	}
	if _, err := validatePublicKey(key); err != nil {
		writeAPIError(w, http.StatusBadRequest, "invalid_peer", err.Error(), reqID)
		return
	}
	inState := s.state.Has(key)
	if err := s.wg.RemovePeer(r.Context(), s.cfg.WGInterface, key); err != nil {
		if !inState {
			// Not ours and WireGuard doesn't know it either: nothing to do.
			writeAPIError(w, http.StatusNotFound, "peer_not_found", "peer is not configured on this node", reqID)
			return
		}
		s.log.Error("wg remove peer failed", map[string]any{"request_id": reqID, "error": err.Error()})
		writeAPIError(w, http.StatusBadGateway, "wireguard_error", "wg failed to remove peer: "+firstLine(err.Error()), reqID)
		return
	}
	if err := s.state.Delete(key); err != nil {
		s.log.Error("failed to persist peer removal", map[string]any{"request_id": reqID, "error": err.Error()})
		writeAPIError(w, http.StatusInternalServerError, "state_error", "peer removed from WireGuard but state persist failed", reqID)
		return
	}
	s.log.Info("peer removed", map[string]any{"request_id": reqID, "peer_count": s.state.Count()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "removedAt": time.Now().Unix()}, reqID)
}

// handleHealth implements GET /health. peerCount is an aggregate — safe.
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"interface": s.cfg.WGInterface,
		"peerCount": s.state.Count(),
		"uptimeSec": int64(time.Since(s.startTime).Seconds()),
		"version":   s.version,
	}, reqID)
}

// handleMetrics implements GET /metrics. Aggregate counters only — no
// per-peer data of any kind, per the no-logs privacy invariant.
func (s *Server) handleMetrics(w http.ResponseWriter, r *http.Request) {
	reqID := requestIDFrom(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{
		"peerCount": s.state.Count(),
		"uptimeSec": int64(time.Since(s.startTime).Seconds()),
		"version":   s.version,
		"interface": s.cfg.WGInterface,
	}, reqID)
}
