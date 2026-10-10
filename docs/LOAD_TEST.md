# VeilVPN — Load Testing

## Free-tier limits (design load around these)

| Service            | Free allowance                          | What it means for us                                                                                      |
| ------------------ | --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Cloudflare Workers | 100,000 requests/day                    | ~1.15 req/s sustained. Auth/connect/billing traffic is tiny; fine for thousands of users at normal usage. |
| Cloudflare D1      | 5M rows read/day, 100k rows written/day | Reads dominate (`GET /v1/nodes`, entitlement checks). Cache node list client-side; don't poll.            |
| Cloudflare KV      | 100k reads/day, 1k writes/day           | Rate-limit buckets are the main consumer; sized accordingly.                                              |

The VPN data plane (WireGuard on the Oracle VM) is **not** load-tested via
the API — node throughput is measured separately with iperf3 (see below).

## k6 script — API smoke load (staging only)

`docs/k6-staging.js` is a real, runnable k6 script (kept in this repo).
Run it **against the staging Worker only**, never production (it burns
free-tier quota):

```js
// (full script: docs/k6-staging.js)
import http from "k6/http";
import { check, sleep } from "k6";

export const options = {
  stages: [
    { duration: "1m", target: 20 }, // ramp to 20 VUs
    { duration: "3m", target: 20 }, // sustain
    { duration: "1m", target: 0 }, // ramp down
  ],
  thresholds: {
    http_req_failed: ["rate<0.01"], // <1% failures
    http_req_duration: ["p(95)<800"], // p95 under 800ms
  },
};
// ... GET /v1/health + /v1/nodes with checks, sleep(1)
```

Run:

```bash
k6 run -e API_BASE=https://veil-api-staging.<you>.workers.dev docs/k6-staging.js
```

**Pass criteria:** thresholds green, zero 5xx, KV rate-limit 429s only on
the intentionally-abused auth endpoints (separate targeted run).

## Node data-plane throughput (iperf3)

On the Oracle VM, with a client connected through the tunnel:

```bash
# on the node (server side, outside the tunnel)
iperf3 -s -p 5201
# on a test client, through the VPN
iperf3 -c <node-public-ip> -p 5201 -t 30 -P 4
```

Record single-tunnel and 50-concurrent-tunnel throughput. A 4-OCPU ARM
Always Free VM running WireGuard userspace typically saturates well above
what the free-tier API can coordinate — the API is the binding constraint,
not the tunnel.

## What we deliberately do NOT load test

- Brute-forcing auth endpoints (rate limiters make this a quota-burn, not a
  useful signal).
- Production D1 write saturation (migrations are forward-only; a saturated
  prod DB is recovered by waiting for the daily reset, not by testing it).
