/**
 * Shared upsert for provider-driven subscriptions (Play / StoreKit).
 * Stripe and LemonSqueezy have their own upserts (richer payloads); the
 * semantics here are identical: match by provider_ref, else the user's live
 * subscription, else create. Provider webhooks are the source of truth.
 */
import { SubscriptionStatus } from "@veil/shared";
import type { Db } from "../db/index.js";
import {
  getLiveSubscriptionByUser,
  getSubscriptionByProviderRef,
  createSubscription,
  updateSubscription,
} from "../db/queries.js";
import { transitionSubscription, GRACE_PERIOD_SEC } from "../entitlement.js";
import { nowSec } from "../util/crypto.js";
import type { SubscriptionRow } from "../db/queries.js";

export interface ProviderSubInput {
  userId: string;
  planId: string;
  provider: "play" | "storekit";
  providerRef: string;
  status: SubscriptionStatus;
  currentPeriodEnd: number | null;
}

export async function upsertProviderSubscription(
  db: Db,
  input: ProviderSubInput,
): Promise<SubscriptionRow> {
  const now = nowSec();
  const existing =
    (await getSubscriptionByProviderRef(db, input.providerRef)) ??
    (await getLiveSubscriptionByUser(db, input.userId));
  if (existing) {
    const legal = transitionSubscription(existing.status, input.status);
    if (!legal)
      console.warn(
        `${input.provider}: unexpected transition ${existing.status} -> ${input.status}`,
      );
    await updateSubscription(db, existing.id, {
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd,
      providerRef: input.providerRef,
      provider: input.provider,
      planId: input.planId,
      graceUntil:
        input.status === SubscriptionStatus.PastDue
          ? existing.graceUntil && existing.graceUntil > now
            ? existing.graceUntil
            : now + GRACE_PERIOD_SEC
          : input.status === SubscriptionStatus.Active
            ? null
            : existing.graceUntil,
    });
    return (await getSubscriptionByProviderRef(
      db,
      input.providerRef,
    )) as SubscriptionRow;
  }
  return createSubscription(db, {
    userId: input.userId,
    planId: input.planId,
    status: input.status,
    provider: input.provider,
    providerRef: input.providerRef,
    currentPeriodEnd: input.currentPeriodEnd,
    graceUntil:
      input.status === SubscriptionStatus.PastDue
        ? now + GRACE_PERIOD_SEC
        : null,
  });
}
