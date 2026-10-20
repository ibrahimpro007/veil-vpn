/**
 * Control-plane client for node agents (apps/node-agent).
 * Agent routes (apps/node-agent/main.go): POST /peers,
 * DELETE /peers/{pubkey}, GET /health, GET /metrics — note there is NO
 * /v1/node prefix; calling one cost us the first end-to-end connect test
 * (2026-10-20: agent 404 → "node did not accept the peer").
 * Implements the HMAC scheme from PHASE1_NOTES.md exactly:
 *   bodyHash = sha256_hex(raw body)            ("" for empty bodies)
 *   message  = "<ts>.<METHOD>.<path>.<bodyHash>"
 *   signature = HMAC_SHA256_hex(key = NODE_AGENT_HMAC_SECRET, message)
 *   headers: X-Veil-Signature, X-Veil-Timestamp   (5-min skew enforced by the agent)
 */
import type { Env } from "./env.js";
import { sha256Hex, hmacSha256Hex, nowSec } from "./util/crypto.js";

export interface NodeTarget {
  endpoint: string; // "host:port"
}

export async function signNodeRequest(
  secret: string,
  method: string,
  path: string,
  rawBody: string,
): Promise<{ signature: string; timestamp: number }> {
  const timestamp = nowSec();
  const bodyHash = await sha256Hex(rawBody);
  const message = `${timestamp}.${method.toUpperCase()}.${path}.${bodyHash}`;
  const signature = await hmacSha256Hex(secret, message);
  return { signature, timestamp };
}

async function nodeFetch(
  env: Env,
  node: NodeTarget,
  method: "POST" | "DELETE",
  path: string,
  body: unknown,
): Promise<{ ok: boolean; status: number }> {
  const rawBody =
    body === undefined || body === null ? "" : JSON.stringify(body);
  const { signature, timestamp } = await signNodeRequest(
    env.NODE_AGENT_HMAC_SECRET,
    method,
    path,
    rawBody,
  );
  // node.endpoint is the WireGuard endpoint "host:wgPort" (UDP). The agent
  // API lives on the same host, port NODE_AGENT_PORT (default 8443), over
  // plain HTTP authenticated by the HMAC signature above — Workers fetch
  // cannot accept the agent's self-signed IP certificate, so TLS is not
  // usable here; payloads carry only peer public keys and tunnel IPs.
  //
  // Workers fetch() to a bare IP literal is refused by the edge with
  // "403 error code: 1003" (direct-IP access) — found the hard way on
  // 2026-10-20 after the HMAC and route fixes. NODE_AGENT_HOST_MAP
  // ("ip=hostname,ip=hostname") gives each node a DNS name for agent
  // calls; unmapped nodes fall back to the raw IP (works outside Workers).
  const ip = node.endpoint.split(":")[0];
  const map = Object.fromEntries(
    (env.NODE_AGENT_HOST_MAP ?? "")
      .split(",")
      .map((pair) => pair.trim().split("="))
      .filter((kv) => kv.length === 2 && kv[0] !== "" && kv[1] !== ""),
  );
  const host = map[ip] ?? ip;
  const agentPort = env.NODE_AGENT_PORT ?? "8443";
  const res = await fetch(`http://${host}:${agentPort}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Veil-Signature": signature,
      "X-Veil-Timestamp": String(timestamp),
    },
    body: rawBody === "" ? undefined : rawBody,
  });
  // TEMP DIAGNOSTIC (2026-10-20 connect debugging): surface the agent's
  // verdict in `wrangler tail` — status + error body only, never secrets.
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.log(
      `nodeFetch ${method} ${path} -> ${res.status} ${text.slice(0, 200)}`,
    );
    return { ok: false, status: res.status };
  }
  return { ok: res.ok, status: res.status };
}

/**
 * Ask the node agent to add a WireGuard peer. Retried once on failure
 * (network blip or agent restart); the caller rolls back the DB row when
 * both attempts fail.
 */
export async function nodeAddPeer(
  env: Env,
  node: NodeTarget,
  publicKey: string,
  assignedIp: string,
  dns: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await nodeFetch(env, node, "POST", "/peers", {
        publicKey,
        assignedIp,
        dns,
      });
      if (r.ok) return true;
    } catch {
      // network error → retry once
    }
  }
  return false;
}

/** Best-effort peer removal. Never throws; reconciliation heals leftovers. */
export async function nodeRemovePeer(
  env: Env,
  node: NodeTarget,
  publicKey: string,
): Promise<boolean> {
  try {
    const path = `/peers/${encodeURIComponent(publicKey)}`;
    const r = await nodeFetch(env, node, "DELETE", path, null);
    return r.ok;
  } catch {
    return false;
  }
}
