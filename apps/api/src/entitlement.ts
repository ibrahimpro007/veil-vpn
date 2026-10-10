/**
 * Entitlement is computed ONLY from the subscriptions table — never from
 * client flags, JWT claims, or request parameters. Every connect/billing
 * decision funnels through computeEntitlement().
 */
import { SubscriptionStatus, type Entitlement } from "@veil/shared";
import { nowSec } from "./util/crypto.js";

/** Grace period for past_due subscriptions: 3 days. */
export const GRACE_PERIOD_SEC = 3 * 86400;

export interface SubscriptionLike {
  id: string;
  userId: string;
  planId: string;
  status: SubscriptionStatus | string;
  currentPeriodEnd: number | null;
  graceUntil: number | null;
  provider: string;
}

export interface PlanLike {
  id: string;
  slug: string;
  deviceLimit: number;
}

/**
 * Resolve what a user may do right now.
 * - trialing/active with a future (or unknown) period end → entitled
 * - past_due within grace (grace_until, else period end + 3 days) → entitled (grace)
 * - anything else, or no subscription → not entitled
 */
export function computeEntitlement(
  userId: string,
  sub: SubscriptionLike | null | undefined,
  plan: PlanLike | null | undefined,
  now: number = nowSec(),
): Entitlement {
  const base = {
    userId,
    planSlug: plan?.slug ?? "none",
    deviceLimit: plan?.deviceLimit ?? 0,
    currentPeriodEnd: sub?.currentPeriodEnd ?? null,
    graceUntil: sub?.graceUntil ?? null,
  };
  if (!sub || !plan) {
    return { ...base, status: SubscriptionStatus.Expired, canConnect: false };
  }
  const status = sub.status as SubscriptionStatus;
  switch (status) {
    case SubscriptionStatus.Trialing:
    case SubscriptionStatus.Active: {
      const canConnect =
        sub.currentPeriodEnd == null || sub.currentPeriodEnd > now;
      return { ...base, status, canConnect };
    }
    case SubscriptionStatus.PastDue: {
      const graceUntil =
        sub.graceUntil ??
        (sub.currentPeriodEnd != null
          ? sub.currentPeriodEnd + GRACE_PERIOD_SEC
          : null);
      const canConnect = graceUntil != null && graceUntil > now;
      return { ...base, status, graceUntil, canConnect };
    }
    case SubscriptionStatus.Canceled:
    case SubscriptionStatus.Expired:
    default:
      return { ...base, status, canConnect: false };
  }
}

/**
 * Subscription state machine. Webhook handlers and the lifecycle cron may
 * only move subscriptions along these edges; anything else is logged and
 * ignored (the provider remains the source of truth, so an illegal edge
 * means our model is behind, not that the provider is wrong — the caller
 * decides whether to force-apply).
 *
 *   trialing → active | past_due | canceled | expired
 *   active   → past_due | canceled | expired   (+ active→active for renewals)
 *   past_due → active | canceled | expired
 *   canceled → active | trialing                (resubscribe)
 *   expired  → active | trialing                (new purchase)
 */
export const ALLOWED_TRANSITIONS: Record<
  SubscriptionStatus,
  SubscriptionStatus[]
> = {
  [SubscriptionStatus.Trialing]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.PastDue,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Expired,
  ],
  [SubscriptionStatus.Active]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.PastDue,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Expired,
  ],
  [SubscriptionStatus.PastDue]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Canceled,
    SubscriptionStatus.Expired,
  ],
  [SubscriptionStatus.Canceled]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Trialing,
  ],
  [SubscriptionStatus.Expired]: [
    SubscriptionStatus.Active,
    SubscriptionStatus.Trialing,
  ],
};

/** Returns the target status when the transition is legal, null otherwise. */
export function transitionSubscription(
  from: SubscriptionStatus | string,
  to: SubscriptionStatus | string,
): SubscriptionStatus | null {
  const fromStatus = from as SubscriptionStatus;
  const toStatus = to as SubscriptionStatus;
  const allowed = ALLOWED_TRANSITIONS[fromStatus];
  if (!allowed) return null;
  return allowed.includes(toStatus) ? toStatus : null;
}
