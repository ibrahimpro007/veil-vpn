// VeilVPN node agent — WireGuard peer management service for VPN exit nodes.
//
// The agent exposes a small HMAC-authenticated HTTPS API used by the VeilVPN
// control plane (Cloudflare Worker) to add/remove WireGuard peers, plus a
// reconciler that continuously drives the live interface toward the desired
// state persisted in /var/lib/veil-agent/peers.json.
//
// Privacy: the agent keeps NO traffic, DNS, or browsing logs — ever. The
// only persisted data is the desired peer set (public keys + tunnel IPs),
// which is the minimum required to rebuild the interface after a reboot.
// Metrics are aggregate counts only.
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"
)

// version is set at build time: go build -ldflags "-X main.version=1.2.3".
var version = "dev"

// Server bundles the agent's dependencies.
type Server struct {
	cfg       *Config
	log       *Logger
	state     *PeerState
	wg        WGRunner
	startTime time.Time
	version   string
}

func main() {
	os.Exit(run())
}

func run() int {
	cfg, err := LoadConfig()
	if err != nil {
		stdLog.Error("invalid configuration", map[string]any{"error": err.Error()})
		return 1
	}
	log := NewLogger(os.Stdout, cfg.Debug)
	if cfg.NodeID != "" {
		log.Info("starting veil-agent", map[string]any{"node_id": cfg.NodeID, "version": version})
	} else {
		log.Info("starting veil-agent", map[string]any{"version": version})
	}

	wgRunner, err := newRealWGRunner()
	if err != nil {
		log.Error("wireguard tooling unavailable", map[string]any{"error": err.Error()})
		return 1
	}

	state, err := LoadPeerState(cfg.StateFile)
	if err != nil {
		log.Error("cannot load desired state", map[string]any{"error": err.Error()})
		return 1
	}
	log.Info("desired state loaded", map[string]any{"peer_count": state.Count()})

	srv := &Server{
		cfg:       cfg,
		log:       log,
		state:     state,
		wg:        wgRunner,
		startTime: time.Now(),
		version:   version,
	}

	// --- routes: every route is HMAC-authenticated; no public endpoints ---
	auth := newHMACAuth(cfg, log)
	mux := http.NewServeMux()
	mux.Handle("POST /peers", auth.Middleware(http.HandlerFunc(srv.handleAddPeer)))
	mux.Handle("DELETE /peers/{pubkey}", auth.Middleware(http.HandlerFunc(srv.handleRemovePeer)))
	mux.Handle("GET /health", auth.Middleware(http.HandlerFunc(srv.handleHealth)))
	mux.Handle("GET /metrics", auth.Middleware(http.HandlerFunc(srv.handleMetrics)))

	handler := requestIDMiddleware(mux)

	// --- reconcile loop ---
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	go func() {
		srv.reconcileOnce(ctx) // heal any drift from downtime immediately
		t := time.NewTicker(cfg.SyncInterval)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				srv.reconcileOnce(ctx)
			}
		}
	}()

	// --- HTTPS server (TLS always; the API pins the cert fingerprint) ---
	cert, err := tls.LoadX509KeyPair(cfg.TLSCertPath, cfg.TLSKeyPath)
	if err != nil {
		// Already validated in LoadConfig; re-checked here to fail fast.
		log.Error("cannot load TLS certificate", map[string]any{"error": err.Error()})
		return 1
	}
	tlsCfg := &tls.Config{MinVersion: tls.VersionTLS12, Certificates: []tls.Certificate{cert}}
	ln, err := tls.Listen("tcp", net.JoinHostPort(cfg.Bind, fmt.Sprint(cfg.Port)), tlsCfg)
	if err != nil {
		log.Error("cannot bind listener", map[string]any{"error": err.Error()})
		return 1
	}

	httpSrv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	go func() {
		log.Info("listening", map[string]any{
			"bind": cfg.Bind, "port": cfg.Port,
			"interface": cfg.WGInterface, "pool": cfg.Pool.String(),
		})
		if err := httpSrv.Serve(ln); err != nil && err != http.ErrServerClosed {
			log.Error("server error", map[string]any{"error": err.Error()})
			stop()
		}
	}()

	// Systemd readiness (no-op outside Type=notify units).
	if err := sdNotify("READY=1"); err != nil {
		log.Warn("sd_notify READY failed", map[string]any{"error": err.Error()})
	}

	<-ctx.Done()
	log.Info("shutting down", nil)
	_ = sdNotify("STOPPING=1")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Error("graceful shutdown failed", map[string]any{"error": err.Error()})
		return 1
	}
	log.Info("stopped", nil)
	return 0
}
