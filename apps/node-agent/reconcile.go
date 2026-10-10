package main

// Reconciler: drives the live WireGuard interface toward the desired state.
//
// ComputeDiff is a pure function (unit-tested) so the add/remove decision
// logic is verifiable without touching the kernel. The live loop logs only
// aggregate counts — never keys or IPs — at info level.

import (
	"context"
	"sort"
)

// DesiredPeer is a peer that should exist on the interface.
type DesiredPeer struct {
	PublicKey  string
	AssignedIP string
}

// ComputeDiff compares desired state (from the state file) with the actual
// peer list (from `wg show <iface> peers`) and returns the peers to add and
// the peer keys to remove.
func ComputeDiff(desired map[string]PeerRecord, actual []string) (toAdd []DesiredPeer, toRemove []string) {
	actualSet := make(map[string]struct{}, len(actual))
	for _, k := range actual {
		actualSet[k] = struct{}{}
	}
	for key, rec := range desired {
		if _, ok := actualSet[key]; !ok {
			toAdd = append(toAdd, DesiredPeer{PublicKey: key, AssignedIP: rec.AssignedIP})
		}
	}
	for _, key := range actual {
		if _, ok := desired[key]; !ok {
			toRemove = append(toRemove, key)
		}
	}
	// Deterministic order for testability and stable logs.
	sort.Slice(toAdd, func(i, j int) bool { return toAdd[i].PublicKey < toAdd[j].PublicKey })
	sort.Strings(toRemove)
	return toAdd, toRemove
}

// reconcileOnce performs a single reconciliation pass.
func (s *Server) reconcileOnce(ctx context.Context) {
	desired := s.state.Snapshot()
	actual, err := s.wg.ListPeers(ctx, s.cfg.WGInterface)
	if err != nil {
		// Fail closed: without a trustworthy view of the interface we change
		// nothing. (Typical cause: wg0 not up yet at boot.)
		s.log.Error("reconcile aborted: cannot list peers", map[string]any{"error": err.Error()})
		return
	}
	toAdd, toRemove := ComputeDiff(desired, actual)

	added, removed, failed := 0, 0, 0
	for _, p := range toAdd {
		if err := s.wg.SetPeer(ctx, s.cfg.WGInterface, p.PublicKey, []string{p.AssignedIP + "/32"}); err != nil {
			failed++
			s.log.Error("reconcile: failed to add peer", map[string]any{"error": err.Error()})
			continue
		}
		added++
	}
	for _, key := range toRemove {
		if err := s.wg.RemovePeer(ctx, s.cfg.WGInterface, key); err != nil {
			failed++
			s.log.Error("reconcile: failed to remove peer", map[string]any{"error": err.Error()})
			continue
		}
		removed++
	}
	// Aggregate counts only — never keys or IPs at info level.
	s.log.Info("reconciled", map[string]any{
		"desired": len(desired),
		"actual":  len(actual),
		"added":   added,
		"removed": removed,
		"failed":  failed,
	})
	if s.log.debug {
		var addKeys []string
		for _, p := range toAdd {
			addKeys = append(addKeys, p.PublicKey)
		}
		s.log.Debug("reconcile detail", map[string]any{"added_keys": addKeys, "removed_keys": toRemove})
	}
}
