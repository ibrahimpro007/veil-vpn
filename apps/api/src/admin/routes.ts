import {
  adminUserSuspendSchema,
  adminUserBanSchema,
  adminDeviceRevokeSchema,
  adminGrantSchema,
  adminNodeUpdateSchema,
  nodeRegisterSchema,
  announcementCreateSchema,
  adminUserSearchQuerySchema,
  auditLogQuerySchema,
  deviceIdParamSchema,
  idSchema,
} from "@veil/shared";
import type { Context } from "hono";
import type { App, Vars } from "../app.js";
import type { Env } from "../env.js";
import { makeDb, type Db } from "../db/index.js";
import {
  findAdminByEmail,
  findAdminById,
  findUserById,
  searchUsers,
  setUserStatus,
  listAllUsers,
  findDeviceById,
  deleteDevice,
  listDevicesByUser,
  getPeerByDevice,
  deletePeerByDevice,
  getNodeById,
  listNodeRows,
  insertNode,
  updateNode,
  getPlanById,
  getLiveSubscriptionByUser,
  createSubscription,
  listSubscriptions,
  listPaymentEvents,
  listAllAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  revokeAllUserRefreshTokens,
} from "../db/queries.js";
import { auditLogs } from "../db/schema.js";
import { desc, eq, count } from "drizzle-orm";
import { appendAudit, verifyAuditChain } from "./audit.js";
import {
  verifyPassword,
  signJwtEdDSA,
  verifyJwtEdDSA,
  aesGcmDecrypt,
  nowSec,
} from "../util/crypto.js";
import { verifyTotp } from "../util/totp.js";
import { nodeRemovePeer } from "../nodeClient.js";
import { requireAdmin } from "../middleware/adminAuth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { rateLimit, clientIp } from "../middleware/rateLimit.js";
import {
  checkLoginAllowed,
  recordLoginFailure,
  clearLoginAttempts,
} from "../auth/lockout.js";
import { jwtIssuer } from "../env.js";

const ADMIN_SESSION_TTL_SEC = 12 * 3600;
const CHALLENGE_TTL_SEC = 5 * 60;

/** Dummy hash so unknown-email and wrong-password logins take the same time. */
const DUMMY_HASH =
  "$pbkdf2-sha256$600000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** Revoke sessions + drop node peers for a user (suspend/ban). Best-effort on nodes. */
async function revokeUserAccess(
  db: Db,
  env: Env,
  userId: string,
): Promise<void> {
  await revokeAllUserRefreshTokens(db, userId, nowSec());
  const devices = await listDevicesByUser(db, userId);
  for (const d of devices) {
    const peer = await getPeerByDevice(db, d.id);
    if (peer) {
      const node = await getNodeById(db, peer.nodeId);
      if (node)
        await nodeRemovePeer(env, { endpoint: node.endpoint }, d.wgPublicKey);
      await deletePeerByDevice(db, d.id);
    }
  }
}

function userProfile(u: {
  id: string;
  email: string;
  emailVerifiedAt: number | null;
  status: string;
  createdAt: number;
}) {
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerifiedAt != null,
    status: u.status,
    createdAt: u.createdAt,
  };
}

async function audit(
  db: Db,
  adminId: string | null,
  action: string,
  entity: string,
  entityId?: string | null,
  detail?: Record<string, unknown> | null,
): Promise<void> {
  await appendAudit(db, {
    actorAdminId: adminId,
    action,
    entity,
    entityId: entityId ?? null,
    detail: detail ? JSON.stringify(detail) : null,
  });
}

export function registerAdminRoutes(app: App): void {
  /* ---------------- admin auth ---------------- */

  /**
   * POST /admin/auth/login — step 1: email + password. Returns a
   * short-lived challenge token; step 2 verifies TOTP.
   */
  app.post(
    "/admin/auth/login",
    rateLimit("admin-login", 20, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const email =
        typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (!email || !password) {
        return apiError(
          c,
          400,
          "validation_error",
          "email and password are required.",
        );
      }
      const ip = clientIp(c);
      const gate = await checkLoginAllowed(
        c.env.RATE_LIMIT,
        ip,
        `admin:${email}`,
      );
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
      const admin = await findAdminByEmail(db, email);
      const ok = await verifyPassword(
        password,
        admin ? admin.passwordHash : DUMMY_HASH,
      );
      if (!admin || !ok || admin.status !== "active") {
        await recordLoginFailure(c.env.RATE_LIMIT, ip, `admin:${email}`);
        await audit(
          db,
          admin?.id ?? null,
          "admin.login_failed",
          "admin_user",
          admin?.id ?? null,
          null,
        );
        return apiError(
          c,
          401,
          "invalid_credentials",
          "Invalid email or password.",
        );
      }
      await clearLoginAttempts(c.env.RATE_LIMIT, ip, `admin:${email}`);
      const now = nowSec();
      // Simple mode (owner request, 2026-10-20): with ADMIN_LOGIN_SIMPLE=true
      // the password alone issues the admin session — no TOTP step. Set the
      // var to "false" (or unset the flag path) to restore mandatory TOTP;
      // the /admin/auth/totp-verify endpoint stays live either way.
      if (c.env.ADMIN_LOGIN_SIMPLE === "true") {
        const sessionToken = await signJwtEdDSA(
          {
            sub: admin.id,
            iss: jwtIssuer(c.env),
            iat: now,
            exp: now + ADMIN_SESSION_TTL_SEC,
            typ: "admin",
            role: admin.role,
          },
          c.env.JWT_EDDSA_PRIVATE_KEY,
        );
        await audit(db, admin.id, "admin.login", "admin_user", admin.id, null);
        return c.json({
          totpRequired: false,
          accessToken: sessionToken,
          sessionToken,
          expiresIn: ADMIN_SESSION_TTL_SEC,
          role: admin.role,
        });
      }
      const challengeToken = await signJwtEdDSA(
        {
          sub: admin.id,
          iss: jwtIssuer(c.env),
          iat: now,
          exp: now + CHALLENGE_TTL_SEC,
          typ: "admin-challenge",
        },
        c.env.JWT_EDDSA_PRIVATE_KEY,
      );
      await audit(
        db,
        admin.id,
        "admin.login_password_ok",
        "admin_user",
        admin.id,
        null,
      );
      return c.json({
        totpRequired: true,
        challengeId: challengeToken,
        expiresIn: CHALLENGE_TTL_SEC,
      });
    },
  );

  /** POST /admin/auth/totp-verify — step 2: TOTP → 12h admin session JWT. */
  app.post(
    "/admin/auth/totp-verify",
    rateLimit("admin-totp", 20, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const challengeToken =
        typeof body?.challengeId === "string"
          ? body.challengeId
          : typeof body?.challengeToken === "string"
            ? body.challengeToken
            : "";
      const code = typeof body?.code === "string" ? body.code : "";
      if (!challengeToken || !code) {
        return apiError(
          c,
          400,
          "validation_error",
          "challengeId and code are required.",
        );
      }
      const claims = await verifyJwtEdDSA(
        challengeToken,
        c.env.JWT_EDDSA_PUBLIC_KEY,
      );
      if (!claims || claims.typ !== "admin-challenge") {
        return apiError(
          c,
          401,
          "invalid_token",
          "Challenge expired or invalid.",
        );
      }
      const db = makeDb(c.env.DB);
      const adminRow = await findAdminById(db, claims.sub);
      if (!adminRow || adminRow.status !== "active") {
        return apiError(c, 401, "unauthorized", "Admin account is not active.");
      }
      let secretB32: string;
      try {
        secretB32 = await aesGcmDecrypt(
          c.env.ADMIN_TOTP_ENC_KEY,
          adminRow.totpSecretEncrypted,
        );
      } catch {
        return apiError(
          c,
          500,
          "server_error",
          "Could not decrypt the TOTP secret.",
        );
      }
      if (!(await verifyTotp(secretB32, code))) {
        await audit(
          db,
          adminRow.id,
          "admin.totp_failed",
          "admin_user",
          adminRow.id,
          null,
        );
        return apiError(c, 401, "invalid_code", "Invalid authenticator code.");
      }
      const now = nowSec();
      const sessionToken = await signJwtEdDSA(
        {
          sub: adminRow.id,
          iss: jwtIssuer(c.env),
          iat: now,
          exp: now + ADMIN_SESSION_TTL_SEC,
          typ: "admin",
          role: adminRow.role,
        },
        c.env.JWT_EDDSA_PRIVATE_KEY,
      );
      await audit(
        db,
        adminRow.id,
        "admin.login",
        "admin_user",
        adminRow.id,
        null,
      );
      return c.json({
        accessToken: sessionToken,
        sessionToken,
        expiresIn: ADMIN_SESSION_TTL_SEC,
        role: adminRow.role,
      });
    },
  );

  /* ---------------- users ---------------- */

  const readRoles = ["owner", "support", "read-only"] as const;
  const writeRoles = ["owner", "support"] as const;

  app.get("/admin/users", requireAdmin([...readRoles]), async (c) => {
    const parsed = adminUserSearchQuerySchema.safeParse({
      search: c.req.query("search") ?? "",
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const status = c.req.query("status") || undefined;
    if (
      status &&
      !["active", "suspended", "banned", "deleted"].includes(status)
    ) {
      return apiError(c, 400, "validation_error", "Invalid status filter.");
    }
    const db = makeDb(c.env.DB);
    const { rows, total } = await searchUsers(db, { ...parsed.data, status });
    return c.json({
      data: rows.map(userProfile),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total,
    });
  });

  async function setStatus(
    c: Context<{ Bindings: Env; Variables: Vars }>,
    status: "suspended" | "banned" | "active",
    action: string,
  ) {
    const idParsed = idSchema.safeParse(c.req.param("id"));
    if (!idParsed.success) return validationError(c, idParsed.error.issues);
    const body = await c.req.json().catch(() => null);
    const schema =
      status === "banned" ? adminUserBanSchema : adminUserSuspendSchema;
    const parsed = schema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const user = await findUserById(db, idParsed.data);
    if (!user) return apiError(c, 404, "not_found", "User not found.");
    await setUserStatus(db, user.id, status);
    if (status !== "active") await revokeUserAccess(db, c.env, user.id);
    const admin = c.get("admin")!;
    await audit(db, admin.id, action, "user", user.id, {
      reason: parsed.data.reason,
    });
    const updated = await findUserById(db, user.id);
    return c.json(userProfile(updated!));
  }

  app.post("/admin/users/:id/suspend", requireAdmin([...writeRoles]), (c) =>
    setStatus(c, "suspended", "admin.user_suspend"),
  );
  app.post("/admin/users/:id/ban", requireAdmin(["owner"]), (c) =>
    setStatus(c, "banned", "admin.user_ban"),
  );
  app.post(
    "/admin/users/:id/unsuspend",
    requireAdmin([...writeRoles]),
    async (c) => {
      const idParsed = idSchema.safeParse(c.req.param("id"));
      if (!idParsed.success) return validationError(c, idParsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = await findUserById(db, idParsed.data);
      if (!user) return apiError(c, 404, "not_found", "User not found.");
      if (user.status === "banned") {
        return apiError(
          c,
          400,
          "invalid_state",
          "Banned users cannot be unsuspended; contact an owner.",
        );
      }
      await setUserStatus(db, user.id, "active");
      const admin = c.get("admin")!;
      await audit(db, admin.id, "admin.user_unsuspend", "user", user.id, null);
      const updated = await findUserById(db, user.id);
      return c.json(userProfile(updated!));
    },
  );

  /* ---------------- devices ---------------- */

  app.post(
    "/admin/devices/:id/revoke",
    requireAdmin([...writeRoles]),
    async (c) => {
      const idParsed = deviceIdParamSchema.safeParse({ id: c.req.param("id") });
      if (!idParsed.success) return validationError(c, idParsed.error.issues);
      const body = await c.req.json().catch(() => ({}));
      const parsed = adminDeviceRevokeSchema.safeParse(body ?? {});
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const device = await findDeviceById(db, idParsed.data.id);
      if (!device) return apiError(c, 404, "not_found", "Device not found.");
      const peer = await getPeerByDevice(db, device.id);
      if (peer) {
        const node = await getNodeById(db, peer.nodeId);
        if (node)
          await nodeRemovePeer(
            c.env,
            { endpoint: node.endpoint },
            device.wgPublicKey,
          );
        await deletePeerByDevice(db, device.id);
      }
      await deleteDevice(db, device.id);
      const admin = c.get("admin")!;
      await audit(db, admin.id, "admin.device_revoke", "device", device.id, {
        userId: device.userId,
        reason: parsed.data.reason ?? null,
      });
      return c.body(null, 204);
    },
  );

  /* ---------------- grants ---------------- */

  app.post("/admin/grants", requireAdmin([...writeRoles]), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = adminGrantSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const user = await findUserById(db, parsed.data.userId);
    if (!user) return apiError(c, 404, "not_found", "User not found.");
    const plan = await getPlanById(db, parsed.data.planId);
    if (!plan || plan.active !== 1)
      return apiError(c, 404, "not_found", "Plan not found.");
    const live = await getLiveSubscriptionByUser(db, user.id);
    if (live) {
      return apiError(
        c,
        400,
        "subscription_exists",
        "User already has a live subscription.",
      );
    }
    const sub = await createSubscription(db, {
      userId: user.id,
      planId: plan.id,
      status: "active",
      provider: "comp",
      currentPeriodEnd: nowSec() + parsed.data.days * 86400,
    });
    const admin = c.get("admin")!;
    await audit(db, admin.id, "admin.grant", "subscription", sub.id, {
      userId: user.id,
      planId: plan.id,
      days: parsed.data.days,
      reason: parsed.data.reason,
    });
    return c.json(
      {
        id: sub.id,
        planId: sub.planId,
        planSlug: plan.slug,
        status: sub.status,
        currentPeriodEnd: sub.currentPeriodEnd,
        graceUntil: sub.graceUntil,
        provider: sub.provider,
      },
      201,
    );
  });

  /* ---------------- subscriptions / payment events ---------------- */

  app.get("/admin/subscriptions", requireAdmin([...readRoles]), async (c) => {
    const status = c.req.query("status") || undefined;
    if (
      status &&
      !["trialing", "active", "past_due", "canceled", "expired"].includes(
        status,
      )
    ) {
      return apiError(c, 400, "validation_error", "Invalid status filter.");
    }
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(c.req.query("pageSize") ?? "25", 10) || 25),
    );
    const db = makeDb(c.env.DB);
    const { rows, total } = await listSubscriptions(db, {
      status,
      page,
      pageSize,
    });
    const plans = new Map<string, string>();
    const data = [];
    for (const s of rows) {
      if (!plans.has(s.planId)) {
        plans.set(
          s.planId,
          (await getPlanById(db, s.planId))?.slug ?? "unknown",
        );
      }
      data.push({
        id: s.id,
        planId: s.planId,
        planSlug: plans.get(s.planId),
        status: s.status,
        currentPeriodEnd: s.currentPeriodEnd,
        graceUntil: s.graceUntil,
        provider: s.provider,
      });
    }
    return c.json({ data, page, pageSize, total });
  });

  app.get("/admin/payment-events", requireAdmin([...readRoles]), async (c) => {
    const provider = c.req.query("provider") || undefined;
    if (
      provider &&
      !["stripe", "lemonsqueezy", "play", "storekit", "comp"].includes(provider)
    ) {
      return apiError(c, 400, "validation_error", "Invalid provider filter.");
    }
    const page = Math.max(1, parseInt(c.req.query("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, parseInt(c.req.query("pageSize") ?? "25", 10) || 25),
    );
    const db = makeDb(c.env.DB);
    const { rows, total } = await listPaymentEvents(db, {
      provider,
      page,
      pageSize,
    });
    return c.json({
      data: rows.map((e) => ({
        id: e.id,
        provider: e.provider,
        providerEventId: e.providerEventId,
        type: e.type,
        payloadHash: e.rawHash,
        amountCents: e.amountCents,
        currency: e.currency,
        processedAt: e.processedAt,
        createdAt: e.createdAt,
      })),
      page,
      pageSize,
      total,
    });
  });

  /* ---------------- nodes ---------------- */

  /**
   * POST /admin/nodes — register an already-provisioned node (owner only).
   * The node starts `disabled`; flip it to `active` via PATCH after the
   * bootstrap output (TLS fingerprint, WireGuard key) checks out.
   */
  app.post("/admin/nodes", requireAdmin(["owner"]), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = nodeRegisterSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const node = await insertNode(db, parsed.data);
    const admin = c.get("admin")!;
    await audit(db, admin.id, "admin.node_register", "vpn_node", node.id, {
      region: node.region,
      endpoint: node.endpoint,
    });
    return c.json(
      {
        id: node.id,
        region: node.region,
        countryCode: node.countryCode,
        city: node.city,
        endpoint: node.endpoint,
        status: node.status,
        sortOrder: node.sortOrder,
        wgPublicKey: node.wgPublicKey,
        capacity: node.capacity,
        ipPoolCidr: node.ipPoolCidr,
        dnsIp: node.dnsIp,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      },
      201,
    );
  });

  app.get("/admin/nodes", requireAdmin([...readRoles]), async (c) => {
    const db = makeDb(c.env.DB);
    const rows = await listNodeRows(db);
    return c.json({
      nodes: rows.map((n) => ({
        id: n.id,
        region: n.region,
        countryCode: n.countryCode,
        city: n.city,
        endpoint: n.endpoint,
        status: n.status,
        sortOrder: n.sortOrder,
        wgPublicKey: n.wgPublicKey,
        capacity: n.capacity,
        ipPoolCidr: n.ipPoolCidr,
        dnsIp: n.dnsIp,
        createdAt: n.createdAt,
        updatedAt: n.updatedAt,
      })),
    });
  });

  app.patch("/admin/nodes/:id", requireAdmin(["owner"]), async (c) => {
    const idParsed = idSchema.safeParse(c.req.param("id"));
    if (!idParsed.success) return validationError(c, idParsed.error.issues);
    const body = await c.req.json().catch(() => null);
    const parsed = adminNodeUpdateSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const node = await getNodeById(db, idParsed.data);
    if (!node) return apiError(c, 404, "not_found", "Node not found.");
    await updateNode(db, node.id, parsed.data);
    const admin = c.get("admin")!;
    await audit(
      db,
      admin.id,
      "admin.node_update",
      "vpn_node",
      node.id,
      parsed.data as Record<string, unknown>,
    );
    const updated = await getNodeById(db, node.id);
    return c.json({
      id: updated!.id,
      region: updated!.region,
      countryCode: updated!.countryCode,
      city: updated!.city,
      endpoint: updated!.endpoint,
      status: updated!.status,
      sortOrder: updated!.sortOrder,
      wgPublicKey: updated!.wgPublicKey,
      capacity: updated!.capacity,
      ipPoolCidr: updated!.ipPoolCidr,
      dnsIp: updated!.dnsIp,
      createdAt: updated!.createdAt,
      updatedAt: updated!.updatedAt,
    });
  });

  /* ---------------- announcements ---------------- */

  app.get("/admin/announcements", requireAdmin([...readRoles]), async (c) => {
    const db = makeDb(c.env.DB);
    const rows = await listAllAnnouncements(db);
    return c.json({
      announcements: rows.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        createdAt: a.createdAt,
      })),
    });
  });

  app.post("/admin/announcements", requireAdmin([...writeRoles]), async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = announcementCreateSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const admin = c.get("admin")!;
    const row = await createAnnouncement(db, {
      ...parsed.data,
      createdByAdminId: admin.id,
    });
    await audit(
      db,
      admin.id,
      "admin.announcement_create",
      "announcement",
      row.id,
      { title: row.title },
    );
    return c.json(
      {
        id: row.id,
        title: row.title,
        body: row.body,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        createdAt: row.createdAt,
      },
      201,
    );
  });

  app.delete(
    "/admin/announcements/:id",
    requireAdmin([...writeRoles]),
    async (c) => {
      const idParsed = idSchema.safeParse(c.req.param("id"));
      if (!idParsed.success) return validationError(c, idParsed.error.issues);
      const db = makeDb(c.env.DB);
      const deleted = await deleteAnnouncement(db, idParsed.data);
      if (!deleted)
        return apiError(c, 404, "not_found", "Announcement not found.");
      const admin = c.get("admin")!;
      await audit(
        db,
        admin.id,
        "admin.announcement_delete",
        "announcement",
        idParsed.data,
        null,
      );
      return c.body(null, 204);
    },
  );

  /* ---------------- audit logs ---------------- */

  app.get("/admin/audit-logs", requireAdmin([...readRoles]), async (c) => {
    const parsed = auditLogQuerySchema.safeParse({
      action: c.req.query("action") || undefined,
      page: c.req.query("page"),
      pageSize: c.req.query("pageSize"),
    });
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const where = parsed.data.action
      ? eq(auditLogs.action, parsed.data.action)
      : undefined;
    const totalRows = await db
      .select({ n: count() })
      .from(auditLogs)
      .where(where);
    const rows = await db
      .select()
      .from(auditLogs)
      .where(where)
      .orderBy(desc(auditLogs.id))
      .limit(parsed.data.pageSize)
      .offset((parsed.data.page - 1) * parsed.data.pageSize);
    return c.json({
      data: rows.map((r) => ({
        id: r.id,
        prevHash: r.prevHash,
        hash: r.hash,
        actorAdminId: r.actorAdminId,
        actorUserId: r.actorUserId,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        detail: r.detail,
        createdAt: r.createdAt,
      })),
      page: parsed.data.page,
      pageSize: parsed.data.pageSize,
      total: totalRows[0]?.n ?? 0,
    });
  });

  app.get(
    "/admin/audit-logs/verify",
    requireAdmin([...readRoles]),
    async (c) => {
      const db = makeDb(c.env.DB);
      const res = await verifyAuditChain(db);
      return c.json({
        valid: res.valid,
        checked: res.checked,
        brokenAtId: res.brokenAtId,
      });
    },
  );

  /* ---------------- CSV export ---------------- */

  app.get("/admin/export/users.csv", requireAdmin(["owner"]), async (c) => {
    const db = makeDb(c.env.DB);
    const admin = c.get("admin")!;
    const users = await listAllUsers(db);
    await audit(db, admin.id, "admin.export_users_csv", "user", null, {
      count: users.length,
    });
    const esc = (v: unknown): string => {
      const s = v == null ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const te = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          te.encode("id,email,name,email_verified,status,created_at\n"),
        );
        for (const u of users) {
          controller.enqueue(
            te.encode(
              [
                u.id,
                u.email,
                u.name,
                u.emailVerifiedAt != null,
                u.status,
                u.createdAt,
              ]
                .map(esc)
                .join(",") + "\n",
            ),
          );
        }
        controller.close();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="veil-users.csv"',
      },
    });
  });
}
