package main

// Tests for the pure reconcile diff function.

import (
	"reflect"
	"testing"
)

func desiredKeys(keys ...string) map[string]PeerRecord {
	m := make(map[string]PeerRecord, len(keys))
	for i, k := range keys {
		m[k] = PeerRecord{AssignedIP: "10.7.0." + string(rune('2'+i)), AddedAt: 1}
	}
	return m
}

func addKeys(peers []DesiredPeer) []string {
	var out []string
	for _, p := range peers {
		out = append(out, p.PublicKey)
	}
	return out
}

func TestComputeDiffEmpty(t *testing.T) {
	add, remove := ComputeDiff(map[string]PeerRecord{}, nil)
	if len(add) != 0 || len(remove) != 0 {
		t.Fatalf("expected no ops, got add=%v remove=%v", add, remove)
	}
}

func TestComputeDiffInSync(t *testing.T) {
	d := desiredKeys("a", "b", "c")
	add, remove := ComputeDiff(d, []string{"a", "b", "c"})
	if len(add) != 0 || len(remove) != 0 {
		t.Fatalf("in-sync state should produce no ops, got add=%v remove=%v", add, remove)
	}
}

func TestComputeDiffAddMissing(t *testing.T) {
	d := desiredKeys("a", "b")
	add, remove := ComputeDiff(d, []string{"b"})
	if !reflect.DeepEqual(addKeys(add), []string{"a"}) {
		t.Fatalf("expected to add [a], got %v", addKeys(add))
	}
	if len(remove) != 0 {
		t.Fatalf("expected no removals, got %v", remove)
	}
	if add[0].AssignedIP != d["a"].AssignedIP {
		t.Fatalf("added peer should carry desired IP, got %q", add[0].AssignedIP)
	}
}

func TestComputeDiffRemoveExtra(t *testing.T) {
	d := desiredKeys("a")
	add, remove := ComputeDiff(d, []string{"a", "stale1", "stale2"})
	if len(add) != 0 {
		t.Fatalf("expected no adds, got %v", addKeys(add))
	}
	if !reflect.DeepEqual(remove, []string{"stale1", "stale2"}) {
		t.Fatalf("expected to remove [stale1 stale2], got %v", remove)
	}
}

func TestComputeDiffBothDirections(t *testing.T) {
	d := desiredKeys("keep", "missing")
	add, remove := ComputeDiff(d, []string{"keep", "rogue"})
	if !reflect.DeepEqual(addKeys(add), []string{"missing"}) {
		t.Fatalf("expected to add [missing], got %v", addKeys(add))
	}
	if !reflect.DeepEqual(remove, []string{"rogue"}) {
		t.Fatalf("expected to remove [rogue], got %v", remove)
	}
}

func TestComputeDiffIgnoresActualDuplicates(t *testing.T) {
	d := desiredKeys("a")
	add, remove := ComputeDiff(d, []string{"a", "a"})
	if len(add) != 0 || len(remove) != 0 {
		t.Fatalf("duplicate actual entries should not cause ops, got add=%v remove=%v", add, remove)
	}
}
