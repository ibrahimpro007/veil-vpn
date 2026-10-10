// VeilVPN API load smoke test (k6) — STAGING ONLY.
// Burns free-tier quota; never run against production.
//   k6 run -e API_BASE=https://veil-api-staging.<you>.workers.dev docs/k6-staging.js
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

const BASE = __ENV.API_BASE || "https://veil-api-staging.example.workers.dev";

export default function () {
  let r = http.get(`${BASE}/v1/health`);
  check(r, { "health 200": (x) => x.status === 200 });

  r = http.get(`${BASE}/v1/nodes`);
  check(r, { "nodes 200": (x) => x.status === 200 });

  sleep(1);
}
