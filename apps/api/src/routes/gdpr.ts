import { z } from "zod";
import { eq } from "drizzle-orm";
import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import { paymentEvents } from "../db/schema.js";
import {
  findUserById,
  listDevicesByUser,
  getLiveSubscriptionByUser,
  getPlanById,
  deleteUser,
  getPeerByDevice,
  deletePeerByDevice,
  getNodeById,
  revokeAllUserRefreshTokens,
} from "../db/queries.js";
import { appendAudit } from "../admin/audit.js";
import { verifyPassword } from "../util/crypto.js";
import { nodeRemovePeer } from "../nodeClient.js";
import { requireUser } from "../middleware/auth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { nowSec } from "../util/crypto.js";

const deleteAccountSchema = z.object({
  password: z.string().min(1).max(256),
});

/**
 * GET /v1/gdpr/export — machine-readable export of everything we hold.
 * Privacy: devices carry no precise timestamps (day granularity only);
 * payment events expose hashes, never raw payloads; peers are current
 * state only (no connection history exists to export).
 */
export function registerGdprRoutes(app: App): void {
  app.get("/v1/gdpr/export", requireUser, async (c) => {
    const db = makeDb(c.env.DB);
    const userId = c.get("authUser")!.id;
    const user = await findUserById(db, userId);
    if (!user)
      return apiError(c, 401, "unauthorized", "Account no longer exists.");

    const devices = await listDevicesByUser(db, userId);
    const live = await getLiveSubscriptionByUser(db, userId);
    const plan = live ? await getPlanById(db, live.planId) : null;

    // Payment events: hashes only, never raw payloads.
    const events = await db
      .select()
      .from(paymentEvents)
      .where(eq(paymentEvents.userId, userId));

    return c.json({
      exportedAt: nowSec(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: user.emailVerifiedAt != null,
        status: user.status,
        createdAt: user.createdAt,
      },
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        platform: d.platform,
        lastSeenDay: d.lastSeenCoarse,
      })),
      subscription: live
        ? {
            id: live.id,
            planId: live.planId,
            planSlug: plan?.slug ?? null,
            status: live.status,
            currentPeriodEnd: live.currentPeriodEnd,
            graceUntil: live.graceUntil,
            provider: live.provider,
          }
        : null,
      paymentEvents: events.map((e) => ({
        provider: e.provider,
        providerEventId: e.providerEventId,
        type: e.type,
        amountCents: e.amountCents,
        currency: e.currency,
        rawHash: e.rawHash,
      })),
      note: "VeilVPN stores no connection history. Active VPN peers are current-state only and are listed under devices via the API while the session is live.",
    });
  });

  /**
   * DELETE /v1/gdpr/account — password-confirmed hard delete. Peers are
   * removed from node agents first (best-effort), then the user row is
   * deleted (CASCADE removes devices, tokens, subscriptions; payment_events
   * keep their rows with user_id SET NULL for financial record-keeping).
   * The audit entry is written BEFORE the delete so actor_user_id survives
   * via ON DELETE SET NULL.
   */
  app.delete("/v1/gdpr/account", requireUser, async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = deleteAccountSchema.safeParse(body);
    if (!parsed.success) return validationError(c, parsed.error.issues);
    const db = makeDb(c.env.DB);
    const userId = c.get("authUser")!.id;
    const user = await findUserById(db, userId);
    if (!user)
      return apiError(c, 401, "unauthorized", "Account no longer exists.");
    const ok = await verifyPassword(parsed.data.password, user.passwordHash);
    if (!ok) {
      return apiError(c, 403, "invalid_password", "Password is incorrect.");
    }

    // Remove live peers from node agents (best-effort), then drop the rows.
    const devices = await listDevicesByUser(db, userId);
    for (const d of devices) {
      const peer = await getPeerByDevice(db, d.id);
      if (peer) {
        const node = await getNodeById(db, peer.nodeId);
        if (node)
          await nodeRemovePeer(
            c.env,
            { endpoint: node.endpoint },
            d.wgPublicKey,
          );
        await deletePeerByDevice(db, d.id);
      }
    }
    await revokeAllUserRefreshTokens(db, userId, nowSec());
    await appendAudit(db, {
      actorUserId: userId,
      action: "user.gdpr_delete",
      entity: "user",
      entityId: userId,
      detail: JSON.stringify({}),
    });
    await deleteUser(db, userId);
    return c.body(null, 204);
  });
}
