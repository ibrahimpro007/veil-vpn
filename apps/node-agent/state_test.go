package main

// Tests for atomic desired-state persistence.

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStateMissingFileIsEmpty(t *testing.T) {
	s, err := LoadPeerState(filepath.Join(t.TempDir(), "peers.json"))
	if err != nil {
		t.Fatalf("missing file should load as empty: %v", err)
	}
	if s.Count() != 0 {
		t.Fatalf("expected empty state, got %d", s.Count())
	}
}

func TestStateRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.json")
	s, err := LoadPeerState(path)
	if err != nil {
		t.Fatal(err)
	}
	k1, k2 := "key-one-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==", "key-two-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=="
	if err := s.Set(k1, PeerRecord{AssignedIP: "10.7.0.2", DNS: "10.7.0.1", AddedAt: 100}); err != nil {
		t.Fatal(err)
	}
	if err := s.Set(k2, PeerRecord{AssignedIP: "10.7.0.3", AddedAt: 200}); err != nil {
		t.Fatal(err)
	}
	if !s.Has(k1) || !s.Has(k2) || s.Count() != 2 {
		t.Fatal("in-memory state incorrect after Set")
	}

	// Reload from disk: must survive the round trip.
	s2, err := LoadPeerState(path)
	if err != nil {
		t.Fatal(err)
	}
	snap := s2.Snapshot()
	if len(snap) != 2 || snap[k1].AssignedIP != "10.7.0.2" || snap[k1].DNS != "10.7.0.1" || snap[k2].AddedAt != 200 {
		t.Fatalf("state did not survive round trip: %+v", snap)
	}

	// Delete persists too.
	if err := s2.Delete(k1); err != nil {
		t.Fatal(err)
	}
	s3, err := LoadPeerState(path)
	if err != nil {
		t.Fatal(err)
	}
	if s3.Has(k1) || !s3.Has(k2) {
		t.Fatal("delete did not persist")
	}
}

func TestStateFilePermissionsAndShape(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "peers.json")
	s, err := LoadPeerState(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.Set("k", PeerRecord{AssignedIP: "10.7.0.9", AddedAt: 1}); err != nil {
		t.Fatal(err)
	}
	fi, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if fi.Mode().Perm() != 0o600 {
		t.Fatalf("state file should be 0600, got %o", fi.Mode().Perm())
	}
	raw, _ := os.ReadFile(path)
	var decoded map[string]any
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("state file is not valid JSON: %v", err)
	}
	peers, ok := decoded["peers"].(map[string]any)
	if !ok || len(peers) != 1 {
		t.Fatalf("unexpected state file shape: %s", raw)
	}
	// No temp files may be left behind by the atomic write.
	entries, _ := os.ReadDir(dir)
	for _, e := range entries {
		if e.Name() != "peers.json" {
			t.Fatalf("stray file left in state dir: %s", e.Name())
		}
	}
}

func TestStateCorruptFileErrors(t *testing.T) {
	path := filepath.Join(t.TempDir(), "peers.json")
	if err := os.WriteFile(path, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadPeerState(path); err == nil {
		t.Fatal("corrupt state file should produce an error, not silent empty state")
	}
}
