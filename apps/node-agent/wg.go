package main

// WireGuard control wrapper.
//
// All WireGuard mutations go through the `wg` CLI via os/exec (stdlib only).
// WGRunner is an interface so handlers and the reconciler can be unit-tested
// with a fake; production uses realWGRunner.
//
// Privacy: the runner never logs keys or IPs itself; callers decide what is
// safe to log (counts at info level, keys only at debug level).

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const wgExecTimeout = 10 * time.Second

// WGRunner abstracts WireGuard peer management.
type WGRunner interface {
	// SetPeer adds (or updates) a peer with the given allowed IPs (/32s).
	SetPeer(ctx context.Context, iface, publicKeyB64 string, allowedIPs []string) error
	// RemovePeer deletes a peer from the interface.
	RemovePeer(ctx context.Context, iface, publicKeyB64 string) error
	// ListPeers returns the base64 public keys of all peers on the interface.
	ListPeers(ctx context.Context, iface string) ([]string, error)
}

// realWGRunner shells out to the wg(8) binary.
type realWGRunner struct {
	bin string // path to wg; resolved at startup
}

func newRealWGRunner() (*realWGRunner, error) {
	bin, err := exec.LookPath("wg")
	if err != nil {
		return nil, fmt.Errorf("wg binary not found in PATH: %w", err)
	}
	return &realWGRunner{bin: bin}, nil
}

func (r *realWGRunner) run(ctx context.Context, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, wgExecTimeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, r.bin, args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		// Sanitize: wg errors can echo arguments; the caller already knows
		// the key, but we keep the message free of raw key material anyway
		// by trimming it to the tool's own stderr text.
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = strings.TrimSpace(stdout.String())
		}
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("wg %s failed: %s", strings.Join(args[:2], " "), firstLine(msg))
	}
	return stdout.String(), nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func (r *realWGRunner) SetPeer(ctx context.Context, iface, publicKeyB64 string, allowedIPs []string) error {
	args := []string{"set", iface, "peer", publicKeyB64, "allowed-ips", strings.Join(allowedIPs, ",")}
	_, err := r.run(ctx, args...)
	return err
}

func (r *realWGRunner) RemovePeer(ctx context.Context, iface, publicKeyB64 string) error {
	_, err := r.run(ctx, "set", iface, "peer", publicKeyB64, "remove")
	return err
}

func (r *realWGRunner) ListPeers(ctx context.Context, iface string) ([]string, error) {
	out, err := r.run(ctx, "show", iface, "peers")
	if err != nil {
		return nil, err
	}
	var peers []string
	for _, line := range strings.Split(out, "\n") {
		if k := strings.TrimSpace(line); k != "" {
			peers = append(peers, k)
		}
	}
	return peers, nil
}
