import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestContext, treq, type TestContext } from "./helpers.js";
import { createEmailToken } from "../src/db/queries.js";
import {
  users,
  devices,
  subscriptions,
  peers,
  refreshTokens,
  auditLogs,
} from "../src/db/schema.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeTestContext();
});

async function setupVerifiedUser(): Promise<{ userId: string; token: string }> {
  const reg = await treq(ctx, "POST", "/v1/auth/register", {
    body: { email: "gdpr@example.com", password: "correct-horse-12" },
  });
  const userId = (reg.json as { userId: string }).userId;
  const { token: vt } = await createEmailToken(ctx.db, userId, "verify");
  await treq(ctx, "POST", "/v1/auth/verify-email", { body: { token: vt } });
  const login = await treq(ctx, "POST", "/v1/auth/login", {
    body: { email: "gdpr@example.com", password: "correct-horse-12" },
  });
  return { userId, token: (login.json as { accessToken: string }).accessToken };
}

describe("GDPR", () => {
  it("export contains the user's data with hashes only, no precise timestamps on devices", async () => {
    const { userId, token } = await setupVerifiedUser();
    const exp = await treq(ctx, "GET", "/v1/gdpr/export", { token });
    expect(exp.status).toBe(200);
    const body = exp.json as Record<string, unknown>;
    const user = body["user"] as Record<string, unknown>;
    expect(user["email"]).toBe("gdpr@example.com");
    expect(user).not.toHaveProperty("passwordHash");
    expect(user).not.toHaveProperty("password_hash");

    const events = body["paymentEvents"] as Record<string, unknown>[];
    for (const e of events) {
      expect(e).not.toHaveProperty("raw");
      if (e["rawHash"]) expect(e["rawHash"]).toMatch(/^[a-f0-9]{64}$/);
    }
    const devices = body["devices"] as Record<string, unknown>[];
    for (const d of devices) {
      expect(d).not.toHaveProperty("createdAt");
    }
    const sub = body["subscription"] as Record<string, unknown> | null;
    expect(sub).not.toBeNull();
    expect(sub!["status"]).toBe("trialing");
    void userId;
  });

  it("delete removes the account, cascades, and keeps an audit trail", async () => {
    const { userId, token } = await setupVerifiedUser();

    // Wrong password → refused.
    const bad = await treq(ctx, "DELETE", "/v1/gdpr/account", {
      token,
      body: { password: "wrong-password-1" },
    });
    expect(bad.status).toBe(403);

    const del = await treq(ctx, "DELETE", "/v1/gdpr/account", {
      token,
      body: { password: "correct-horse-12" },
    });
    expect(del.status).toBe(204);

    // User row gone; devices/subscriptions/tokens cascaded; peers gone.
    expect(
      await ctx.db.select().from(users).where(eq(users.id, userId)),
    ).toHaveLength(0);
    expect(await ctx.db.select().from(devices)).toHaveLength(0);
    expect(
      await ctx.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId)),
    ).toHaveLength(0);
    expect(await ctx.db.select().from(peers)).toHaveLength(0);
    expect(await ctx.db.select().from(refreshTokens)).toHaveLength(0);

    // The audit entry survives (actor_user_id SET NULL on delete).
    const logs = await ctx.db.select().from(auditLogs);
    const gdprLog = logs.find((l) => l.action === "user.gdpr_delete");
    expect(gdprLog).toBeTruthy();
    expect(gdprLog!.actorUserId).toBeNull();

    // The access token no longer authenticates.
    const me = await treq(ctx, "GET", "/v1/me", { token });
    expect(me.status).toBe(401);
  });
});
