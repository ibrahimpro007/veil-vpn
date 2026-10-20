import {
  registerSchema,
  loginSchema,
  verifyEmailSchema,
  passwordResetRequestSchema,
  passwordResetConfirmSchema,
  refreshTokenSchema,
} from "@veil/shared";
import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import {
  findUserByEmail,
  createUser,
  setEmailVerified,
  updateUserPassword,
  consumeEmailToken,
  createEmailToken,
  findRefreshTokenByHash,
  revokeFamily,
  revokeAllUserRefreshTokens,
  getLiveSubscriptionByUser,
  getPlanBySlug,
  createSubscription,
} from "../db/queries.js";
import {
  hashPassword,
  verifyPassword,
  sha256Hex,
  nowSec,
} from "../util/crypto.js";
import {
  sendEmail,
  verifyEmailHtml,
  resetPasswordHtml,
} from "../util/email.js";
import { isDisposableEmail } from "../util/disposable.js";
import { issueSession, rotateRefresh } from "../auth/sessions.js";
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginAttempts,
} from "../auth/lockout.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";
import { apiError, validationError } from "../middleware/errors.js";

const TRIAL_DAYS = 7;

/**
 * Dummy hash burned when the account doesn't exist, so the "unknown email"
 * and "wrong password" paths take the same time (no timing enumeration).
 */
const DUMMY_HASH =
  "$pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function registerAuthRoutes(app: App): void {
  /**
   * POST /v1/auth/register — always 201 with the same shape, whether or not
   * the email is already registered (anti-enumeration). A verification email
   * is queued only for genuinely new accounts.
   */
  app.post("/v1/auth/register", rateLimit("register", 10, 3600), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = registerSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    // Spam hardening: disposable/temp-mail domains are rejected outright —
    // they account for most bulk fake signups.
    if (isDisposableEmail(parsed.data.email)) {
      return apiError(
        c,
        400,
        "validation_error",
        "Disposable email addresses are not allowed. Please use a real email address.",
      );
    }
    const db = makeDb(c.env.DB);
    const existing = await findUserByEmail(db, parsed.data.email);
    if (existing) {
      return c.json(
        {
          userId: existing.id,
          emailVerificationRequired: existing.emailVerifiedAt == null,
        },
        201,
      );
    }
    const user = await createUser(db, {
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
    });
    const { token } = await createEmailToken(db, user.id, "verify");
    const { subject, html } = verifyEmailHtml(c.env.APP_URL, token);
    // Best-effort: registration succeeds even if the mail provider is down.
    await sendEmail(c.env, user.email, subject, html);
    return c.json({ userId: user.id, emailVerificationRequired: true }, 201);
  });

  /** POST /v1/auth/login — 401 with a generic message on any credential failure. */
  app.post("/v1/auth/login", rateLimit("login", 30, 3600), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const ip = clientIp(c);
    const email = parsed.data.email;
    const gate = await checkLoginAllowed(c.env.RATE_LIMIT, ip, email);
    if (!gate.allowed) {
      c.header("Retry-After", String(gate.retryAfterSec));
      return apiError(
        c,
        429,
        "rate_limited",
        "Too many login attempts. Try again later.",
      );
    }
    const db = makeDb(c.env.DB);
    const user = await findUserByEmail(db, email);
    const ok = await verifyPassword(
      parsed.data.password,
      user ? user.passwordHash : DUMMY_HASH,
    );
    if (!user || !ok) {
      // Same response whether the email exists or the password is wrong.
      await recordLoginFailure(c.env.RATE_LIMIT, ip, email);
      return apiError(
        c,
        401,
        "invalid_credentials",
        "Invalid email or password.",
      );
    }
    if (user.status === "suspended") {
      return apiError(
        c,
        403,
        "account_suspended",
        "This account has been suspended.",
      );
    }
    if (user.status !== "active") {
      return apiError(
        c,
        403,
        "account_banned",
        "This account is no longer active.",
      );
    }
    await clearLoginAttempts(c.env.RATE_LIMIT, ip, email);
    const tokens = await issueSession(db, c.env, user.id);
    return c.json(tokens);
  });

  /**
   * POST /v1/auth/google — sign in with a Google ID token (client request,
   * 2026-10-20). The token is verified by Google's tokeninfo endpoint
   * (signature + expiry checked there); the audience must match one of the
   * configured GOOGLE_OAUTH_CLIENT_IDS (comma-separated: web client ID for
   * Android's serverClientId, desktop client ID for the Windows loopback
   * flow). New users are created with a locked (unusable) password hash and
   * pre-verified email — Google already verified it.
   */
  app.post("/v1/auth/google", rateLimit("login", 30, 3600), async (c) => {
    // Google sign-in is gated by GOOGLE_SIGNIN_ENABLED (enabled 2026-10-20
    // once the OAuth clients were created). Set it to anything but "true"
    // to pause the endpoint without a code change.
    if (c.env.GOOGLE_SIGNIN_ENABLED !== "true") {
      return apiError(
        c,
        503,
        "not_configured",
        "Google sign-in is not configured on this server yet.",
      );
    }
    const body = await c.req.json().catch(() => null);
    const idToken = typeof body?.idToken === "string" ? body.idToken : "";
    if (!idToken) {
      return apiError(c, 400, "validation_error", "idToken is required.");
    }
    const clientIds = (c.env.GOOGLE_OAUTH_CLIENT_IDS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (clientIds.length === 0) {
      return apiError(
        c,
        503,
        "not_configured",
        "Google sign-in is not configured on this server yet.",
      );
    }
    const verifyRes = await fetch(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    ).catch(() => null);
    if (!verifyRes || !verifyRes.ok) {
      return apiError(c, 401, "invalid_token", "Invalid Google token.");
    }
    const info = (await verifyRes.json().catch(() => null)) as {
      aud?: string;
      email?: string;
      email_verified?: string;
      name?: string;
    } | null;
    if (
      !info ||
      !info.aud ||
      !clientIds.includes(info.aud) ||
      info.email_verified !== "true" ||
      !info.email
    ) {
      return apiError(
        c,
        401,
        "invalid_token",
        "Google token could not be verified for this app.",
      );
    }
    const email = info.email.trim().toLowerCase();
    const db = makeDb(c.env.DB);
    let user = await findUserByEmail(db, email);
    if (!user) {
      user = await createUser(db, {
        email,
        passwordHash: `oauth-google:${crypto.randomUUID()}`,
        name: info.name ?? null,
      });
      await setEmailVerified(db, user.id, nowSec());
    }
    // Google users skip the verify-email step (their email is pre-verified),
    // so grant the same welcome trial here when they have no live
    // subscription — without it the client blocks connect with
    // "No active subscription" (bug found 2026-10-20).
    const liveSub = await getLiveSubscriptionByUser(db, user.id);
    if (!liveSub) {
      const trialPlan = await getPlanBySlug(db, "free-trial");
      if (trialPlan) {
        await createSubscription(db, {
          userId: user.id,
          planId: trialPlan.id,
          status: "trialing",
          provider: "comp",
          currentPeriodEnd: nowSec() + TRIAL_DAYS * 86400,
        });
      }
    }
    if (user.status === "suspended") {
      return apiError(
        c,
        403,
        "account_suspended",
        "This account has been suspended.",
      );
    }
    if (user.status !== "active") {
      return apiError(
        c,
        403,
        "account_banned",
        "This account is no longer active.",
      );
    }
    const tokens = await issueSession(db, c.env, user.id);
    return c.json(tokens);
  });

  /** POST /v1/auth/refresh — rotate; reuse of a revoked token revokes the family. */
  app.post("/v1/auth/refresh", rateLimit("refresh", 60, 3600), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = refreshTokenSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const res = await rotateRefresh(db, c.env, parsed.data.refreshToken);
    if (!res.ok) {
      return apiError(
        c,
        401,
        res.reason === "reused" ? "token_reused" : "invalid_token",
        res.reason === "reused"
          ? "Refresh token reuse detected; the session family was revoked."
          : "Invalid or expired refresh token.",
      );
    }
    return c.json(res.tokens);
  });

  /** POST /v1/auth/logout — revoke the whole refresh-token family. Always 204. */
  app.post("/v1/auth/logout", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = refreshTokenSchema.safeParse(body);
    if (parsed.success) {
      const db = makeDb(c.env.DB);
      const row = await findRefreshTokenByHash(
        db,
        await sha256Hex(parsed.data.refreshToken),
      );
      if (row) await revokeFamily(db, row.familyId, nowSec());
    }
    return c.body(null, 204);
  });

  /**
   * POST /v1/auth/verify-email — single-use token. On success a 7-day
   * complimentary trial subscription is created (if the user has no live
   * subscription), so a verified user can connect immediately.
   */
  app.post(
    "/v1/auth/verify-email",
    rateLimit("verify-email", 20, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = verifyEmailSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const tokenRow = await consumeEmailToken(db, parsed.data.token, "verify");
      if (!tokenRow) {
        return apiError(
          c,
          400,
          "invalid_token",
          "Verification link is invalid or expired.",
        );
      }
      await setEmailVerified(db, tokenRow.userId, nowSec());
      const live = await getLiveSubscriptionByUser(db, tokenRow.userId);
      if (!live) {
        const trialPlan = await getPlanBySlug(db, "free-trial");
        if (trialPlan) {
          await createSubscription(db, {
            userId: tokenRow.userId,
            planId: trialPlan.id,
            status: "trialing",
            provider: "comp",
            currentPeriodEnd: nowSec() + TRIAL_DAYS * 86400,
          });
        }
      }
      return c.json({ verified: true });
    },
  );

  /**
   * POST /v1/auth/forgot-password — always 200 with the same body, whether
   * or not the account exists (anti-enumeration).
   */
  app.post(
    "/v1/auth/forgot-password",
    rateLimit("forgot-password", 5, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = passwordResetRequestSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = await findUserByEmail(db, parsed.data.email);
      if (user && user.status === "active") {
        const { token } = await createEmailToken(db, user.id, "reset");
        const { subject, html } = resetPasswordHtml(c.env.APP_URL, token);
        await sendEmail(c.env, user.email, subject, html);
      }
      return c.json({ ok: true });
    },
  );

  /**
   * POST /v1/auth/reset-password — single-use token; revokes all refresh
   * tokens so every other session is signed out.
   */
  app.post(
    "/v1/auth/reset-password",
    rateLimit("reset-password", 10, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = passwordResetConfirmSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const tokenRow = await consumeEmailToken(db, parsed.data.token, "reset");
      if (!tokenRow) {
        return apiError(
          c,
          400,
          "invalid_token",
          "Reset link is invalid or expired.",
        );
      }
      await updateUserPassword(
        db,
        tokenRow.userId,
        await hashPassword(parsed.data.newPassword),
      );
      await revokeAllUserRefreshTokens(db, tokenRow.userId, nowSec());
      return c.json({ ok: true });
    },
  );
}
