/**
 * Scheduled jobs (see [triggers] in infra/wrangler.toml).
 *
 * Every 15 minutes (cronRevokeLapsed): find subscriptions that are no longer
 * entitled but still have WireGuard peers, remove the peers from the node
 * agents (best-effort), and delete the peer rows.
 *
 * Hourly (cronPurgeTokens): purge expired/used email tokens and revoked or
 * long-expired refresh tokens.
 *
 * Hourly (cronSubscriptionLifecycle): advance subscription states that the
 * provider webhooks may have missed (safety net — webhooks are primary):
 *   trialing with period end in the past → expired
 *   past_due with grace exhausted → expired
 *   active with period end in the past → past_due + fresh 3-day grace
 */
import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm";
import { SubscriptionStatus } from "@veil/shared";
import type { Env } from "./env.js";
import { makeDb } from "./db/index.js";
import { subscriptions } from "./db/schema.js";
import {
  listPeersForSweep,
  deletePeerById,
  purgeEmailTokens,
  purgeRefreshTokens,
  updateSubscription,
} from "./db/queries.js";
import { computeEntitlement, GRACE_PERIOD_SEC } from "./entitlement.js";
import { nodeRemovePeer } from "./nodeClient.js";
import { nowSec } from "./util/crypto.js";

export interface RevokeResult {
  checked: number;
  peersRemoved: number;
}

/**
 * Revoke peers whose subscription is no longer entitled. Exported for tests.
 */
export async function cronRevokeLapsed(
  env: Env,
  now: number = nowSec(),
): Promise<RevokeResult> {
  const db = makeDb(env.DB);
  const rows = await listPeersForSweep(env.DB);
  let peersRemoved = 0;
  for (const r of rows) {
    const ent = computeEntitlement(
      r.userId,
      r.subId
        ? {
            id: r.subId,
            userId: r.userId,
            planId: "",
            status: r.subStatus as SubscriptionStatus,
            currentPeriodEnd: r.subPeriodEnd,
            graceUntil: r.subGraceUntil,
            provider: "",
          }
        : null,
      r.planSlug
        ? { id: "", slug: r.planSlug, deviceLimit: r.planDeviceLimit ?? 0 }
        : null,
      now,
    );
    if (ent.canConnect) continue;
    await nodeRemovePeer(env, { endpoint: r.nodeEndpoint }, r.devicePubkey);
    await deletePeerById(db, r.peerId);
    peersRemoved++;
  }
  return { checked: rows.length, peersRemoved };
}

export interface PurgeResult {
  emailTokens: number;
  refreshTokens: number;
}

export async function cronPurgeTokens(
  env: Env,
  now: number = nowSec(),
): Promise<PurgeResult> {
  const db = makeDb(env.DB);
  const emailTokens = await purgeEmailTokens(db, now);
  const refreshTokens = await purgeRefreshTokens(db, now - 30 * 86400);
  return { emailTokens, refreshTokens };
}

export interface LifecycleResult {
  trialingExpired: number;
  pastDueExpired: number;
  activeToPastDue: number;
}

export async function cronSubscriptionLifecycle(
  env: Env,
  now: number = nowSec(),
): Promise<LifecycleResult> {
  const db = makeDb(env.DB);
  const res: LifecycleResult = {
    trialingExpired: 0,
    pastDueExpired: 0,
    activeToPastDue: 0,
  };

  // Trials that ran out without converting.
  const staleTrials = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, SubscriptionStatus.Trialing),
        isNotNull(subscriptions.currentPeriodEnd),
        lte(subscriptions.currentPeriodEnd, now),
      ),
    );
  for (const s of staleTrials) {
    await updateSubscription(db, s.id, {
      status: SubscriptionStatus.Expired,
      graceUntil: null,
    });
    res.trialingExpired++;
  }

  // Past-due subscriptions whose grace ran out.
  const stalePastDue = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, SubscriptionStatus.PastDue),
        or(
          and(
            isNotNull(subscriptions.graceUntil),
            lte(subscriptions.graceUntil, now),
          ),
          and(
            isNull(subscriptions.graceUntil),
            isNotNull(subscriptions.currentPeriodEnd),
            lte(subscriptions.currentPeriodEnd, now - GRACE_PERIOD_SEC),
          ),
        ),
      ),
    );
  for (const s of stalePastDue) {
    await updateSubscription(db, s.id, {
      status: SubscriptionStatus.Expired,
      graceUntil: null,
    });
    res.pastDueExpired++;
  }

  // Active subscriptions past period end with no renewal webhook: safety net.
  const staleActive = await db
    .select({ id: subscriptions.id, graceUntil: subscriptions.graceUntil })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.status, SubscriptionStatus.Active),
        isNotNull(subscriptions.currentPeriodEnd),
        lte(subscriptions.currentPeriodEnd, now),
      ),
    );
  for (const s of staleActive) {
    await updateSubscription(db, s.id, {
      status: SubscriptionStatus.PastDue,
      graceUntil:
        s.graceUntil && s.graceUntil > now
          ? s.graceUntil
          : now + GRACE_PERIOD_SEC,
    });
    res.activeToPastDue++;
  }

  return res;
}
