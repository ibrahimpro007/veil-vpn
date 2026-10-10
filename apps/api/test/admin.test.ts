import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  makeTestContext,
  treq,
  testWgKey,
  type TestContext,
} from "./helpers.js";
import { createAdmin, createUser } from "../src/db/queries.js";
import { hashPassword, aesGcmEncrypt } from "../src/util/crypto.js";
import { newTotpSecret, totpCode } from "../src/util/totp.js";
import { users, subscriptions } from "../src/db/schema.js";

let ctx: TestContext;

const OWNER_SECRET = newTotpSecret();
const SUPPORT_SECRET = newTotpSecret();
const RO_SECRET = newTotpSecret();

beforeEach(async () => {
  ctx = await makeTestContext();
  for (const [email, role, secret] of [
    ["owner@example.com", "owner", OWNER_SECRET],
    ["support@example.com", "support", SUPPORT_SECRET],
    ["ro@example.com", "read-only", RO_SECRET],
  ] as const) {
    await createAdmin(ctx.db, {
      email,
      passwordHash: await hashPassword("correct-horse-12"),
      role,
      totpSecretEncrypted: await aesGcmEncrypt(
        ctx.env.ADMIN_TOTP_ENC_KEY,
        secret,
      ),
    });
  }
});

async function adminLogin(email: string, secret: string): Promise<string> {
  const step1 = await treq(ctx, "POST", "/admin/auth/login", {
    body: { email, password: "correct-horse-12" },
  });
  expect(step1.status).toBe(200);
  expect((step1.json as { totpRequired: boolean }).totpRequired).toBe(true);
  const challengeToken = (step1.json as { challengeToken: string })
    .challengeToken;
  const code = await totpCode(secret);
  const step2 = await treq(ctx, "POST", "/admin/auth/totp-verify", {
    body: { challengeToken, code },
  });
  expect(step2.status).toBe(200);
  return (step2.json as { accessToken: string }).accessToken;
}

describe("admin auth", () => {
  it("requires both password and TOTP", async () => {
    const bad = await treq(ctx, "POST", "/admin/auth/login", {
      body: { email: "owner@example.com", password: "wrong-password-1" },
    });
    expect(bad.status).toBe(401);

    const step1 = await treq(ctx, "POST", "/admin/auth/login", {
      body: { email: "owner@example.com", password: "correct-horse-12" },
    });
    const challengeToken = (step1.json as { challengeToken: string })
      .challengeToken;
    const badTotp = await treq(ctx, "POST", "/admin/auth/totp-verify", {
      body: { challengeToken, code: "000000" },
    });
    expect(badTotp.status).toBe(401);
  });

  it("rejects unauthenticated admin routes", async () => {
    const r = await treq(ctx, "GET", "/admin/users");
    expect(r.status).toBe(401);
  });
});

describe("admin user management", () => {
  it("suspend → unsuspend → ban with RBAC enforcement", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const support = await adminLogin("support@example.com", SUPPORT_SECRET);
    const ro = await adminLogin("ro@example.com", RO_SECRET);

    const user = await createUser(ctx.db, {
      email: "target@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });

    // read-only can search but not mutate
    const search = await treq(ctx, "GET", "/admin/users?search=target", {
      adminToken: ro,
    });
    expect(search.status).toBe(200);
    expect((search.json as { total: number }).total).toBe(1);
    const roSuspend = await treq(
      ctx,
      "POST",
      `/admin/users/${user.id}/suspend`,
      {
        adminToken: ro,
        body: { reason: "x" },
      },
    );
    expect(roSuspend.status).toBe(403);

    // support can suspend
    const susp = await treq(ctx, "POST", `/admin/users/${user.id}/suspend`, {
      adminToken: support,
      body: { reason: "abuse report #42" },
    });
    expect(susp.status).toBe(200);
    expect((susp.json as { status: string }).status).toBe("suspended");

    // support cannot ban (owner only)
    const supportBan = await treq(ctx, "POST", `/admin/users/${user.id}/ban`, {
      adminToken: support,
      body: { reason: "x" },
    });
    expect(supportBan.status).toBe(403);

    const unsusp = await treq(
      ctx,
      "POST",
      `/admin/users/${user.id}/unsuspend`,
      {
        adminToken: support,
      },
    );
    expect(unsusp.status).toBe(200);
    expect((unsusp.json as { status: string }).status).toBe("active");

    const ban = await treq(ctx, "POST", `/admin/users/${user.id}/ban`, {
      adminToken: owner,
      body: { reason: "fraud" },
    });
    expect(ban.status).toBe(200);
    expect((ban.json as { status: string }).status).toBe("banned");
    const [row] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.id, user.id));
    expect(row.status).toBe("banned");
  });

  it("grants a complimentary subscription", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const user = await createUser(ctx.db, {
      email: "grant@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    const g = await treq(ctx, "POST", "/admin/grants", {
      adminToken: owner,
      body: {
        userId: user.id,
        planId: "plan_monthly",
        days: 30,
        reason: "beta tester",
      },
    });
    expect(g.status).toBe(201);
    expect((g.json as { provider: string }).provider).toBe("comp");
    expect((g.json as { planSlug: string }).planSlug).toBe("monthly");

    // A second grant fails: one live subscription per user.
    const g2 = await treq(ctx, "POST", "/admin/grants", {
      adminToken: owner,
      body: {
        userId: user.id,
        planId: "plan_monthly",
        days: 30,
        reason: "again",
      },
    });
    expect(g2.status).toBe(400);

    const subs = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    expect(subs).toHaveLength(1);
  });
});

describe("admin audit + nodes", () => {
  it("verify endpoint reports a healthy chain after admin actions", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const user = await createUser(ctx.db, {
      email: "auditme@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    await treq(ctx, "POST", `/admin/users/${user.id}/suspend`, {
      adminToken: owner,
      body: { reason: "test" },
    });
    const v = await treq(ctx, "GET", "/admin/audit-logs/verify", {
      adminToken: owner,
    });
    expect(v.status).toBe(200);
    expect((v.json as { valid: boolean }).valid).toBe(true);
    expect((v.json as { checked: number }).checked).toBeGreaterThan(0);

    const list = await treq(
      ctx,
      "GET",
      "/admin/audit-logs?action=admin.user_suspend",
      {
        adminToken: owner,
      },
    );
    expect(list.status).toBe(200);
    expect((list.json as { total: number }).total).toBe(1);
  });

  it("owner can update node status; support cannot", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const support = await adminLogin("support@example.com", SUPPORT_SECRET);
    await ctx.d1
      .prepare(
        `INSERT INTO vpn_nodes (id, region, country_code, city, endpoint, wg_public_key, capacity, status, ip_pool_cidr, dns_ip, sort_order, created_at, updated_at)
         VALUES ('node_9','eu','DE','Berlin','node9.test:51820','AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',100,'active','10.9.0.0/24','10.9.0.1',0,1,1)`,
      )
      .run();
    const denied = await treq(ctx, "PATCH", "/admin/nodes/node_9", {
      adminToken: support,
      body: { status: "draining" },
    });
    expect(denied.status).toBe(403);
    const ok = await treq(ctx, "PATCH", "/admin/nodes/node_9", {
      adminToken: owner,
      body: { status: "draining", capacity: 50 },
    });
    expect(ok.status).toBe(200);
    expect((ok.json as { status: string }).status).toBe("draining");
    expect((ok.json as { capacity: number }).capacity).toBe(50);

    // Public node list still shows it, without capacity/load figures.
    const pub = await treq(ctx, "GET", "/v1/nodes");
    const nodes = (pub.json as { nodes: Record<string, unknown>[] }).nodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).not.toHaveProperty("capacity");
    expect(nodes[0]).not.toHaveProperty("ipPoolCidr");
    expect(nodes[0].status).toBe("draining");
  });

  it("owner can register a node (starts disabled); support cannot; bad input rejected", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const support = await adminLogin("support@example.com", SUPPORT_SECRET);
    const body = {
      region: "eu-west",
      countryCode: "DE",
      city: "Frankfurt",
      endpoint: "203.0.113.10:51820",
      wgPublicKey: testWgKey(7),
      capacity: 250,
      ipPoolCidr: "10.7.0.0/24",
      dnsIp: "10.7.0.1",
    };
    const denied = await treq(ctx, "POST", "/admin/nodes", {
      adminToken: support,
      body,
    });
    expect(denied.status).toBe(403);

    const bad = await treq(ctx, "POST", "/admin/nodes", {
      adminToken: owner,
      body: { ...body, endpoint: "not-a-hostport" },
    });
    expect(bad.status).toBe(400);

    const ok = await treq(ctx, "POST", "/admin/nodes", {
      adminToken: owner,
      body,
    });
    expect(ok.status).toBe(201);
    const node = ok.json as { id: string; status: string; countryCode: string };
    expect(node.id).toHaveLength(36); // opaque UUID
    expect(node.status).toBe("disabled");
    expect(node.countryCode).toBe("DE");

    // Registered but disabled: not offered to clients yet.
    const pub = await treq(ctx, "GET", "/v1/nodes");
    expect((pub.json as { nodes: unknown[] }).nodes).toHaveLength(0);

    // Owner can enable it after verification.
    const en = await treq(ctx, "PATCH", `/admin/nodes/${node.id}`, {
      adminToken: owner,
      body: { status: "active" },
    });
    expect(en.status).toBe(200);
    const pub2 = await treq(ctx, "GET", "/v1/nodes");
    expect((pub2.json as { nodes: unknown[] }).nodes).toHaveLength(1);

    // Registration wrote an audit row.
    const logs = await treq(
      ctx,
      "GET",
      "/admin/audit-logs?action=admin.node_register",
      {
        adminToken: owner,
      },
    );
    expect(logs.status).toBe(200);
    expect((logs.json as { total: number }).total).toBe(1);
  });

  it("announcements CRUD + public window", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const created = await treq(ctx, "POST", "/admin/announcements", {
      adminToken: owner,
      body: { title: "Maintenance", body: "Downtime Sunday." },
    });
    expect(created.status).toBe(201);
    const id = (created.json as { id: string }).id;

    const pub = await treq(ctx, "GET", "/v1/announcements");
    expect(
      (pub.json as { announcements: unknown[] }).announcements,
    ).toHaveLength(1);

    const del = await treq(ctx, "DELETE", `/admin/announcements/${id}`, {
      adminToken: owner,
    });
    expect(del.status).toBe(204);
    const pub2 = await treq(ctx, "GET", "/v1/announcements");
    expect(
      (pub2.json as { announcements: unknown[] }).announcements,
    ).toHaveLength(0);
  });

  it("owner can export users.csv", async () => {
    const owner = await adminLogin("owner@example.com", OWNER_SECRET);
    const support = await adminLogin("support@example.com", SUPPORT_SECRET);
    const denied = await treq(ctx, "GET", "/admin/export/users.csv", {
      adminToken: support,
    });
    expect(denied.status).toBe(403);
    const csv = await treq(ctx, "GET", "/admin/export/users.csv", {
      adminToken: owner,
    });
    expect(csv.status).toBe(200);
    expect(csv.headers.get("Content-Type")).toContain("text/csv");
    expect(csv.text).toContain(
      "id,email,name,email_verified,status,created_at",
    );
  });
});
