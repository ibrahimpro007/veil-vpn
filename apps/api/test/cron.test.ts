import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestContext, testWgKey, type TestContext } from "./helpers.js";
import {
  createUser,
  createDevice,
  createPeer,
  createSubscription,
} from "../src/db/queries.js";
import { vpnNodes, peers } from "../src/db/schema.js";
import { hashPassword, nowSec } from "../src/util/crypto.js";
import { cronRevokeLapsed, cronPurgeTokens } from "../src/cron.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeTestContext();
});

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

/** Node-agent DELETE calls are best-effort; the mock just records them. */
function mockNodeDelete(calls: string[]) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (
    input: unknown,
    init: Record<string, unknown> = {},
  ) => {
    const url = String(input);
    if (url.startsWith("https://node1.test")) {
      calls.push(`${init.method} ${new URL(url).pathname}`);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return (real as typeof fetch)(input as never, init as never);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

describe("cronRevokeLapsed", () => {
  it("removes peers whose subscription lapsed and keeps entitled ones", async () => {
    await setupNode();
    const u1 = await createUser(ctx.db, {
      email: "lapsed@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    const u2 = await createUser(ctx.db, {
      email: "ok@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    await createSubscription(ctx.db, {
      userId: u1.id,
      planId: "plan_monthly",
      status: "expired",
      provider: "stripe",
      providerRef: "sub_old",
      currentPeriodEnd: nowSec() - 100,
    });
    await createSubscription(ctx.db, {
      userId: u2.id,
      planId: "plan_monthly",
      status: "active",
      provider: "stripe",
      providerRef: "sub_new",
      currentPeriodEnd: nowSec() + 86400,
    });
    const d1 = await createDevice(ctx.db, {
      userId: u1.id,
      name: "old",
      platform: "linux",
      wgPublicKey: testWgKey(21),
    });
    const d2 = await createDevice(ctx.db, {
      userId: u2.id,
      name: "new",
      platform: "linux",
      wgPublicKey: testWgKey(22),
    });
    await createPeer(ctx.db, {
      deviceId: d1.id,
      nodeId: "node_1",
      assignedIp: "10.7.0.2",
    });
    await createPeer(ctx.db, {
      deviceId: d2.id,
      nodeId: "node_1",
      assignedIp: "10.7.0.3",
    });

    const calls: string[] = [];
    const restore = mockNodeDelete(calls);
    try {
      const res = await cronRevokeLapsed(ctx.env);
      expect(res.checked).toBe(2);
      expect(res.peersRemoved).toBe(1);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toBe(
        `DELETE /v1/node/peers/${encodeURIComponent(testWgKey(21))}`,
      );

      const remaining = await ctx.db.select().from(peers);
      expect(remaining).toHaveLength(1);
      expect(remaining[0].deviceId).toBe(d2.id);
    } finally {
      restore();
    }
  });

  it("is a no-op when every peer is entitled", async () => {
    await setupNode();
    const res = await cronRevokeLapsed(ctx.env);
    expect(res).toEqual({ checked: 0, peersRemoved: 0 });
  });
});

describe("cronPurgeTokens", () => {
  it("purges expired email tokens and old revoked refresh tokens", async () => {
    const { createEmailToken, storeRefreshToken } =
      await import("../src/db/queries.js");
    const u = await createUser(ctx.db, {
      email: "tok@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    // An expired token (created with negative TTL) and a fresh one.
    await createEmailToken(ctx.db, u.id, "verify", -10);
    await createEmailToken(ctx.db, u.id, "verify", 3600);
    // A revoked refresh token older than 30 days, and a fresh one.
    await storeRefreshToken(ctx.db, {
      id: "rt_old",
      userId: u.id,
      tokenHash: "oldhash",
      familyId: "fam_old",
      expiresAt: nowSec() + 100,
    });
    await ctx.d1
      .prepare("UPDATE refresh_tokens SET revoked_at = ?1 WHERE id = 'rt_old'")
      .bind(nowSec() - 31 * 86400)
      .run();
    await storeRefreshToken(ctx.db, {
      id: "rt_new",
      userId: u.id,
      tokenHash: "newhash",
      familyId: "fam_new",
      expiresAt: nowSec() + 86400,
    });

    const res = await cronPurgeTokens(ctx.env);
    expect(res.emailTokens).toBe(1);
    expect(res.refreshTokens).toBe(1);
  });
});
