package main

// Desired-state persistence.
//
// /var/lib/veil-agent/peers.json holds the desired peer set: the peers the
// control plane asked for. The reconciler continuously drives the live
// WireGuard interface toward this file.
//
// Writes are atomic (temp file + fsync + rename) so a crash can never leave
// a half-written state file. The file contains only public keys and tunnel
// IPs — the minimum needed to rebuild the interface. It is mode 0600 and
// lives on a root-only path.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
)

// PeerRecord is the desired state for one peer.
type PeerRecord struct {
	AssignedIP string `json:"assigned_ip"`
	DNS        string `json:"dns,omitempty"`
	AddedAt    int64  `json:"added_at"` // Unix seconds
}

type stateFile struct {
	Peers map[string]PeerRecord `json:"peers"`
}

// PeerState is the concurrency-safe in-memory desired state, backed by the
// atomic state file.
type PeerState struct {
	mu    sync.RWMutex
	path  string
	peers map[string]PeerRecord
}

// LoadPeerState reads the state file (tolerating "does not exist" as empty)
// and returns the live state object.
func LoadPeerState(path string) (*PeerState, error) {
	s := &PeerState{path: path, peers: make(map[string]PeerRecord)}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return s, nil
		}
		return nil, fmt.Errorf("read state file: %w", err)
	}
	if len(bytes.TrimSpace(data)) == 0 {
		return s, nil
	}
	var sf stateFile
	if err := json.Unmarshal(data, &sf); err != nil {
		return nil, fmt.Errorf("parse state file %s: %w", path, err)
	}
	if sf.Peers != nil {
		s.peers = sf.Peers
	}
	return s, nil
}

// Snapshot returns a copy of the desired peer map.
func (s *PeerState) Snapshot() map[string]PeerRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]PeerRecord, len(s.peers))
	for k, v := range s.peers {
		out[k] = v
	}
	return out
}

// Count returns the number of desired peers (aggregate only — safe to expose).
func (s *PeerState) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.peers)
}

// Has reports whether the peer is in desired state.
func (s *PeerState) Has(publicKeyB64 string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, ok := s.peers[publicKeyB64]
	return ok
}

// Set records a peer and persists. Callers must apply the change to WireGuard
// separately (the reconciler heals any drift).
func (s *PeerState) Set(publicKeyB64 string, rec PeerRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.peers[publicKeyB64] = rec
	return s.saveLocked()
}

// Delete removes a peer and persists. Deleting a missing peer is a no-op.
func (s *PeerState) Delete(publicKeyB64 string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.peers, publicKeyB64)
	return s.saveLocked()
}

// saveLocked writes the state atomically: temp file in the same directory,
// fsync, then rename over the target.
func (s *PeerState) saveLocked() error {
	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, ".peers-*.tmp")
	if err != nil {
		return fmt.Errorf("create temp state file: %w", err)
	}
	tmpName := tmp.Name()
	// Best-effort cleanup on failure; on success the rename consumes tmpName.
	defer func() {
		_ = os.Remove(tmpName)
	}()

	enc := json.NewEncoder(tmp)
	enc.SetIndent("", "  ")
	if err := enc.Encode(stateFile{Peers: s.peers}); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("encode state file: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return fmt.Errorf("fsync state file: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close state file: %w", err)
	}
	if err := os.Chmod(tmpName, 0o600); err != nil {
		return fmt.Errorf("chmod state file: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("rename state file: %w", err)
	}
	// Fsync the directory so the rename itself is durable.
	if dh, err := os.Open(dir); err == nil {
		_ = dh.Sync()
		_ = dh.Close()
	}
	return nil
}
