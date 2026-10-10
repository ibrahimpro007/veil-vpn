# VeilVPN — Leak Test Checklist

Run this checklist on **real devices** (not emulators) for every platform
before a client release is published. Tunnel adapters behave differently on
real hardware — emulator passes do not count.

Test sites: https://dnsleaktest.com (extended test), https://ipleak.net,
https://browserleak.com (WebRTC section).

## 1. Baseline (no VPN)

- [ ] Note your real public IP and ISP DNS (visit ipleak.net with VPN off).
- [ ] Note whether you have IPv6 connectivity (test-ipv6.com).

## 2. DNS leak

- [ ] Connect VeilVPN. Run the **extended** test at dnsleaktest.com.
- [ ] **Expected:** only VeilVPN node DNS servers / the configured
      resolver (`10.7.0.1` → upstream via the node) appear. No ISP DNS.
- [ ] Repeat on ipleak.net → "DNS addresses" section: same expectation.
- [ ] Repeat after switching nodes and after an app restart.

## 3. IPv6 leak

- [ ] With VPN connected, visit test-ipv6.com and ipleak.net.
- [ ] **Expected:** no public IPv6 address of your own is visible. The
      client must either block IPv6 or route it through the tunnel; any
      native IPv6 address leaking = FAIL.

## 4. WebRTC leak

- [ ] With VPN connected, check browserleak.com → WebRTC.
- [ ] **Expected:** no local or public IPs outside the tunnel are exposed
      (or WebRTC is disabled). Any real ISP IP = FAIL.

## 5. IP / geolocation consistency

- [ ] ipleak.net shows the VPN exit IP, and it matches the node's
      region/city shown in the app.
- [ ] Torrent-address check (if applicable): the address seen by the
      checker equals the exit IP.

## 6. Kill switch

- [ ] Connect, start a continuous ping to `1.1.1.1` and a download.
- [ ] Kill the tunnel process / disable the VPN adapter at OS level
      (Windows: stop the `VeilVPNHelper` task; Android: revoke VPN
      permission; macOS: unload the packet tunnel).
- [ ] **Expected:** all traffic stops — ping fails, download stalls, and no
      packets leave via the physical interface (verify with Wireshark /
      `tcpdump` on the router if available).
- [ ] Re-enable: traffic resumes only through the tunnel.

## 7. Reconnect storm

- [ ] Toggle connect/disconnect 20 times in quick succession.
- [ ] **Expected:** no duplicate peers accumulate on the node
      (`wg show wg0` peer count returns to baseline), the app always ends in
      a consistent state, and no traffic leaks during the flapping window.

## 8. Captive portal / network change

- [ ] Connect on Wi-Fi, then switch to mobile data (Android) or unplug
      Ethernet (Windows/macOS).
- [ ] **Expected:** the tunnel re-establishes; during the gap, the kill
      switch blocks traffic (no direct requests succeed).

## 9. App kill / reboot

- [ ] Force-stop the app while connected; reboot the device with
      "connect on boot" enabled (if the platform supports it).
- [ ] **Expected:** no traffic leaks before the tunnel is up; on boot the
      device either blocks traffic until connected or stays disconnected —
      never silently unprotected.

## 10. Sign-off

Record per release (append to BUILD_REPORT.md or the release notes):

| Platform | Build | DNS       | IPv6      | WebRTC    | Kill switch | Reconnect | Tester | Date |
| -------- | ----- | --------- | --------- | --------- | ----------- | --------- | ------ | ---- |
| Windows  |       | pass/fail | pass/fail | pass/fail | pass/fail   | pass/fail |        |      |
| Android  |       | pass/fail | pass/fail | pass/fail | pass/fail   | pass/fail |        |      |
| macOS    |       | pass/fail | pass/fail | pass/fail | pass/fail   | pass/fail |        |      |

A release ships only when every cell is `pass`.
