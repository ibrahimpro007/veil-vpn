import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  makeTestContext,
  treq,
  testWgKey,
  type TestContext,
} from "./helpers.js";
import { createEmailToken, updateSubscription } from "../src/db/queries.js";
import { vpnNodes, peers, subscriptions } from "../src/db/schema.js";
import { hmacSha256Hex, sha256Hex, nowSec } from "../src/util/crypto.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeTestContext();
});

interface NodeCall {
  method: string;
  path: string;
  signature: string | null;
  timestamp: string | null;
  body: unknown;
}

/** Capture control-plane calls to the node agent instead of hitting the network. */
function mockNodeAgent(calls: NodeCall[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (
    input: unknown,
    init: Record<string, unknown> = {},
  ) => {
    const url = String(input);
    if (url.startsWith("https://node1.test")) {
      const headers = (init.headers ?? {}) as Record<string, string>;
      calls.push({
        method: String(init.method ?? "GET"),
        path: new URL(url).pathname,
        signature: headers["X-Veil-Signature"] ?? null,
        timestamp: headers["X-Veil-Timestamp"] ?? null,
        body: init.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return (real as typeof fetch)(input as never, init as never);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

async function setupUser(): Promise<{ userId: string; token: string }> {
  const reg = await treq(ctx, "POST", "/v1/auth/register", {
    body: { email: "vpn@example.com", password: "correct-horse-12" },
  });
  const userId = (reg.json as { userId: string }).userId;
  const { token: verifyToken } = await createEmailToken(
    ctx.db,
    userId,
    "verify",
  );
  await treq(ctx, "POST", "/v1/auth/verify-email", {
    body: { token: verifyToken },
  });
  const login = await treq(ctx, "POST", "/v1/auth/login", {
    body: { email: "vpn@example.com", password: "correct-horse-12" },
  });
  return { userId, token: (login.json as { accessToken: string }).accessToken };
}

async function setupNode() {
  await ctx.db.insert(vpnNodes).values({
    id: "node_1",
    region: "eu-west",
    countryCode: "DE",
    city: "Frankfurt",
    endpoint: "node1.test:51820",
    wgPublicKey: testWgKey(9),
    capacity: 100,
    status: "active",
    ipPoolCidr: "10.7.0.0/24",
    dnsIp: "10.7.0.1",
    sortOrder: 0,
    createdAt: nowSec(),
    updatedAt: nowSec(),
  });
}

describe("connect / disconnect", () => {
  it("allocates an IP, registers the peer with an HMAC-signed call, and returns a config", async () => {
    const { userId, token } = await setupUser();
    await setupNode();
    // Trial plan allows 1 device; upgrade to monthly (limit 5) for this test.
    const [trial] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    await updateSubscription(ctx.db, trial.id, { planId: "plan_monthly" });
    const calls: NodeCall[] = [];
    const restore = mockNodeAgent(calls);
    try {
      const dev = await treq(ctx, "POST", "/v1/devices", {
        token,
        body: { name: "laptop", platform: "linux", wgPublicKey: testWgKey(1) },
      });
      expect(dev.status).toBe(201);
      const deviceId = (dev.json as { id: string }).id;

      const conn = await treq(ctx, "POST", "/v1/connect", {
        token,
        body: { deviceId },
      });
      expect(conn.status).toBe(200);
      const cfg = conn.json as Record<string, unknown>;
      // .1 is the node's DNS resolver — never handed to a peer.
      expect(cfg["address"]).toBe("10.7.0.2");
      expect(cfg["subnet"]).toBe("10.7.0.0/24");
      expect(cfg["serverPublicKey"]).toBe(testWgKey(9));
      expect(cfg["endpoint"]).toBe("node1.test:51820");
      expect(cfg["dns"]).toBe("10.7.0.1");
      expect(cfg["allowedIps"]).toEqual(["0.0.0.0/0"]);
      expect((cfg["node"] as { id: string }).id).toBe("node_1");
      expect(typeof cfg["expiresAt"]).toBe("number");

      // Peer row persisted.
      const peerRows = await ctx.db.select().from(peers);
      expect(peerRows).toHaveLength(1);
      expect(peerRows[0].assignedIp).toBe("10.7.0.2");

      // The node agent call was HMAC-signed per the PHASE1 scheme.
      expect(calls).toHaveLength(1);
      const call = calls[0];
      expect(call.method).toBe("POST");
      expect(call.path).toBe("/v1/node/peers");
      expect(call.body).toEqual({
        publicKey: testWgKey(1),
        assignedIp: "10.7.0.2",
        dns: "10.7.0.1",
      });
      const bodyHash = await sha256Hex(JSON.stringify(call.body));
      const message = `${call.timestamp}.POST./v1/node/peers.${bodyHash}`;
      const expectedSig = await hmacSha256Hex(
        ctx.env.NODE_AGENT_HMAC_SECRET,
        message,
      );
      expect(call.signature).toBe(expectedSig);
      expect(Math.abs(nowSec() - Number(call.timestamp))).toBeLessThan(300);

      // Idempotent: connecting again returns the same config, no new node call.
      const conn2 = await treq(ctx, "POST", "/v1/connect", {
        token,
        body: { deviceId },
      });
      expect(conn2.status).toBe(200);
      expect((conn2.json as { address: string }).address).toBe("10.7.0.2");
      expect(calls).toHaveLength(1);

      // A second device gets the next IP.
      const dev2 = await treq(ctx, "POST", "/v1/devices", {
        token,
        body: { name: "phone", platform: "android", wgPublicKey: testWgKey(2) },
      });
      const deviceId2 = (dev2.json as { id: string }).id;
      const conn3 = await treq(ctx, "POST", "/v1/connect", {
        token,
        body: { deviceId: deviceId2 },
      });
      expect((conn3.json as { address: string }).address).toBe("10.7.0.3");

      // Disconnect removes the peer via a signed DELETE.
      const disc = await treq(ctx, "POST", "/v1/disconnect", {
        token,
        body: { deviceId },
      });
      expect(disc.status).toBe(204);
      expect(
        await ctx.db.select().from(peers).where(eq(peers.deviceId, deviceId)),
      ).toHaveLength(0);
      const del = calls[calls.length - 1];
      expect(del.method).toBe("DELETE");
      expect(del.path).toBe(
        `/v1/node/peers/${encodeURIComponent(testWgKey(1))}`,
      );
      expect(del.signature).toMatch(/^[a-f0-9]{64}$/);
    } finally {
      restore();
    }
  });

  it("returns 402 without an entitlement", async () => {
    const { userId, token } = await setupUser();
    await setupNode();
    const dev = await treq(ctx, "POST", "/v1/devices", {
      token,
      body: { name: "laptop", platform: "linux", wgPublicKey: testWgKey(3) },
    });
    const deviceId = (dev.json as { id: string }).id;
    // Cancel the trial subscription.
    const [s] = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    await updateSubscription(ctx.db, s.id, { status: "canceled" });
    const conn = await treq(ctx, "POST", "/v1/connect", {
      token,
      body: { deviceId },
    });
    expect(conn.status).toBe(402);
    expect((conn.json as { error: { code: string } }).error.code).toBe(
      "payment_required",
    );
  });

  it("rejects devices owned by another user", async () => {
    const a = await setupUser();
    await setupNode();
    const dev = await treq(ctx, "POST", "/v1/devices", {
      token: a.token,
      body: { name: "laptop", platform: "linux", wgPublicKey: testWgKey(4) },
    });
    const deviceId = (dev.json as { id: string }).id;

    const reg2 = await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "other@example.com", password: "correct-horse-12" },
    });
    const otherId = (reg2.json as { userId: string }).userId;
    const { token: vt } = await createEmailToken(ctx.db, otherId, "verify");
    await treq(ctx, "POST", "/v1/auth/verify-email", { body: { token: vt } });
    const login2 = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "other@example.com", password: "correct-horse-12" },
    });
    const otherToken = (login2.json as { accessToken: string }).accessToken;

    const conn = await treq(ctx, "POST", "/v1/connect", {
      token: otherToken,
      body: { deviceId },
    });
    expect(conn.status).toBe(404);
  });

  it("enforces the device limit", async () => {
    const { token } = await setupUser(); // trial plan → device_limit 1
    const d1 = await treq(ctx, "POST", "/v1/devices", {
      token,
      body: { name: "one", platform: "linux", wgPublicKey: testWgKey(5) },
    });
    expect(d1.status).toBe(201);
    const d2 = await treq(ctx, "POST", "/v1/devices", {
      token,
      body: { name: "two", platform: "android", wgPublicKey: testWgKey(6) },
    });
    expect(d2.status).toBe(403);
    expect((d2.json as { error: { code: string } }).error.code).toBe(
      "device_limit_reached",
    );
  });

  it("rejects duplicate WireGuard keys", async () => {
    const { token } = await setupUser();
    await treq(ctx, "POST", "/v1/devices", {
      token,
      body: { name: "one", platform: "linux", wgPublicKey: testWgKey(7) },
    });
    const dupe = await treq(ctx, "POST", "/v1/devices", {
      token,
      body: { name: "two", platform: "android", wgPublicKey: testWgKey(7) },
    });
    expect(dupe.status).toBe(409);
  });
});
