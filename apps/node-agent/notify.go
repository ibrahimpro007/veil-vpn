package main

// Optional systemd readiness notification.
//
// When the unit uses Type=notify, systemd sets NOTIFY_SOCKET and expects
// READY=1 once the service is accepting traffic. This is stdlib-only
// (unixgram datagram, no dependencies). Absence of NOTIFY_SOCKET simply
// disables notification (e.g. when running in Docker or by hand).

import (
	"net"
	"os"
)

func sdNotify(state string) error {
	sock := os.Getenv("NOTIFY_SOCKET")
	if sock == "" {
		return nil // not running under systemd with Type=notify
	}
	addr := &net.UnixAddr{Name: sock, Net: "unixgram"}
	conn, err := net.DialUnix("unixgram", nil, addr)
	if err != nil {
		return err
	}
	defer conn.Close()
	_, err = conn.Write([]byte(state))
	return err
}
