import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestContext, treq, type TestContext } from "./helpers.js";
import { subscriptions, users } from "../src/db/schema.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeTestContext();
});

describe("auth flow", () => {
  it("register → verify → login → me", async () => {
    const reg = await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "alice@example.com", password: "correct-horse-12" },
    });
    expect(reg.status).toBe(201);
    const userId = (reg.json as { userId: string }).userId;
    expect(typeof userId).toBe("string");

    // Registering the same email again still returns 201 (no enumeration).
    const reg2 = await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "alice@example.com", password: "correct-horse-12" },
    });
    expect(reg2.status).toBe(201);

    // Grab the verification token row and verify via a fresh token we mint
    // through the real endpoint path (forgot-password reuses the same table).
    const loginBefore = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "alice@example.com", password: "correct-horse-12" },
    });
    expect(loginBefore.status).toBe(200);
    expect(
      (loginBefore.json as { accessToken: string }).accessToken,
    ).toBeTruthy();

    // Verify the email using a token created through the real code path:
    // request password reset is a different purpose, so instead call the
    // verify endpoint with a token minted by the same helper the register
    // route uses (imported directly — same code, no shortcut).
    const { createEmailToken } = await import("../src/db/queries.js");
    const { token } = await createEmailToken(ctx.db, userId, "verify");
    const verify = await treq(ctx, "POST", "/v1/auth/verify-email", {
      body: { token },
    });
    expect(verify.status).toBe(200);
    expect((verify.json as { verified: boolean }).verified).toBe(true);

    // A 7-day trialing subscription was granted on verification.
    const subs = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, userId));
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("trialing");
    expect(subs[0].provider).toBe("comp");

    // Reusing the token fails (single-use).
    const verify2 = await treq(ctx, "POST", "/v1/auth/verify-email", {
      body: { token },
    });
    expect(verify2.status).toBe(400);

    const me = await treq(ctx, "GET", "/v1/me", {
      token: (loginBefore.json as { accessToken: string }).accessToken,
    });
    expect(me.status).toBe(200);
    expect((me.json as { email: string }).email).toBe("alice@example.com");
    expect((me.json as { emailVerified: boolean }).emailVerified).toBe(true);

    // Every response carries a request id.
    expect(me.headers.get("X-Request-Id")).toBeTruthy();
    expect((me.json as { requestId?: string }).requestId).toBeUndefined(); // success bodies don't need it
  });

  it("rejects bad credentials generically and locks out after 5 failures", async () => {
    await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "bob@example.com", password: "correct-horse-12" },
    });
    const ip = "10.9.9.9";
    for (let i = 0; i < 5; i++) {
      const r = await treq(ctx, "POST", "/v1/auth/login", {
        body: { email: "bob@example.com", password: "wrong-password-1" },
        ip,
      });
      expect(r.status).toBe(401);
      expect((r.json as { error: { code: string } }).error.code).toBe(
        "invalid_credentials",
      );
    }
    // 6th attempt (even with the right password) is locked out.
    const locked = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "bob@example.com", password: "correct-horse-12" },
      ip,
    });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("Retry-After")).toBeTruthy();
  });

  it("refresh rotation + reuse detection revokes the family", async () => {
    await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "carol@example.com", password: "correct-horse-12" },
    });
    const login = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "carol@example.com", password: "correct-horse-12" },
    });
    const refresh1 = (login.json as { refreshToken: string }).refreshToken;

    const r1 = await treq(ctx, "POST", "/v1/auth/refresh", {
      body: { refreshToken: refresh1 },
    });
    expect(r1.status).toBe(200);
    const refresh2 = (r1.json as { refreshToken: string }).refreshToken;
    expect(refresh2).not.toBe(refresh1);

    // Reusing the old (rotated) token → reuse detected, family revoked.
    const reuse = await treq(ctx, "POST", "/v1/auth/refresh", {
      body: { refreshToken: refresh1 },
    });
    expect(reuse.status).toBe(401);
    expect((reuse.json as { error: { code: string } }).error.code).toBe(
      "token_reused",
    );

    // The newest token is dead too — the whole family was revoked.
    const dead = await treq(ctx, "POST", "/v1/auth/refresh", {
      body: { refreshToken: refresh2 },
    });
    expect(dead.status).toBe(401);
  });

  it("logout revokes the family", async () => {
    await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "dave@example.com", password: "correct-horse-12" },
    });
    const login = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "dave@example.com", password: "correct-horse-12" },
    });
    const refresh = (login.json as { refreshToken: string }).refreshToken;
    const out = await treq(ctx, "POST", "/v1/auth/logout", {
      body: { refreshToken: refresh },
    });
    expect(out.status).toBe(204);
    const again = await treq(ctx, "POST", "/v1/auth/refresh", {
      body: { refreshToken: refresh },
    });
    expect(again.status).toBe(401);
  });

  it("forgot-password is enumeration-safe; reset rotates the password and kills sessions", async () => {
    await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "erin@example.com", password: "correct-horse-12" },
    });
    const login = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "erin@example.com", password: "correct-horse-12" },
    });
    const oldRefresh = (login.json as { refreshToken: string }).refreshToken;

    // Unknown email → same 200.
    const f1 = await treq(ctx, "POST", "/v1/auth/forgot-password", {
      body: { email: "nobody@example.com" },
    });
    expect(f1.status).toBe(200);
    const f2 = await treq(ctx, "POST", "/v1/auth/forgot-password", {
      body: { email: "erin@example.com" },
    });
    expect(f2.status).toBe(200);
    expect(f1.json).toEqual(f2.json);

    const { createEmailToken } = await import("../src/db/queries.js");
    const [u] = await ctx.db
      .select()
      .from(users)
      .where(eq(users.email, "erin@example.com"));
    const { token } = await createEmailToken(ctx.db, u.id, "reset");
    const reset = await treq(ctx, "POST", "/v1/auth/reset-password", {
      body: { token, newPassword: "brand-new-password-99" },
    });
    expect(reset.status).toBe(200);

    // Old password dead, new password works, old refresh token revoked.
    const badLogin = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "erin@example.com", password: "correct-horse-12" },
    });
    expect(badLogin.status).toBe(401);
    const goodLogin = await treq(ctx, "POST", "/v1/auth/login", {
      body: { email: "erin@example.com", password: "brand-new-password-99" },
    });
    expect(goodLogin.status).toBe(200);
    const stale = await treq(ctx, "POST", "/v1/auth/refresh", {
      body: { refreshToken: oldRefresh },
    });
    expect(stale.status).toBe(401);
  });

  it("validates input and rejects weak passwords", async () => {
    const r = await treq(ctx, "POST", "/v1/auth/register", {
      body: { email: "not-an-email", password: "short" },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: { code: string } }).error.code).toBe(
      "validation_error",
    );
  });
});
