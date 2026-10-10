/**
 * Stripe adapter: Checkout Sessions + Customer Portal via the Stripe REST API
 * (plain fetch, no SDK), and webhook signature verification + event handling.
 *
 * Webhook verification: HMAC-SHA256 over "<timestamp>.<rawBody>" compared
 * against the stripe-signature header's v1= value, with a 5-minute skew
 * window and constant-time comparison.
 */
import { SubscriptionStatus } from "@veil/shared";
import type { Env } from "../env.js";
import type { Db } from "../db/index.js";
import type { PlanRow, SubscriptionRow } from "../db/queries.js";
import {
  getLiveSubscriptionByUser,
  getSubscriptionByProviderRef,
  createSubscription,
  updateSubscription,
  listActivePlans,
  addAbuseFlag,
} from "../db/queries.js";
import { transitionSubscription, GRACE_PERIOD_SEC } from "../entitlement.js";
import { hmacSha256Hex, timingSafeEqual, nowSec } from "../util/crypto.js";
import {
  PortalUnsupportedError,
  providerRefs,
  type PaymentProvider,
  type CheckoutArgs,
  type PortalArgs,
} from "./provider.js";

async function stripeApi(
  env: Env,
  method: "GET" | "POST",
  path: string,
  form: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.stripe.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: method === "POST" ? new URLSearchParams(form) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `stripe ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

function priceIdFor(plan: PlanRow): string | null {
  return providerRefs(plan)["stripe"] ?? null;
}

export class StripeAdapter implements PaymentProvider {
  readonly providerName = "stripe" as const;

  async createCheckout({
    user,
    plan,
    env,
  }: CheckoutArgs): Promise<{ url: string }> {
    const priceId = priceIdFor(plan);
    if (!priceId)
      throw new Error(`plan ${plan.slug} is not configured for Stripe`);
    const session = await stripeApi(env, "POST", "/v1/checkout/sessions", {
      mode: "subscription",
      "line_items[0][price]": priceId,
      "line_items[0][quantity]": "1",
      success_url: `${env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${env.APP_URL}/billing/cancel`,
      client_reference_id: user.id,
      customer_email: user.email,
      "metadata[user_id]": user.id,
      "subscription_data[metadata][user_id]": user.id,
    });
    if (typeof session["url"] !== "string")
      throw new Error("stripe did not return a checkout url");
    return { url: session["url"] as string };
  }

  async createPortal({
    subscription,
    env,
  }: PortalArgs): Promise<{ url: string }> {
    const customerId = subscription.providerCustomerId;
    if (!customerId)
      throw new PortalUnsupportedError("stripe (no customer on file)");
    const portal = await stripeApi(env, "POST", "/v1/billing_portal/sessions", {
      customer: customerId,
      return_url: `${env.APP_URL}/account`,
    });
    if (typeof portal["url"] !== "string")
      throw new Error("stripe did not return a portal url");
    return { url: portal["url"] as string };
  }

  async verifyWebhook(
    rawBody: string,
    headers: Headers,
    env: Env,
  ): Promise<boolean> {
    return verifyStripeSignature(
      rawBody,
      headers.get("stripe-signature"),
      env.STRIPE_WEBHOOK_SECRET,
    );
  }
}

/** Parse and verify the Stripe-Signature header. Pure — unit-testable. */
export async function verifyStripeSignature(
  rawBody: string,
  header: string | null,
  secret: string,
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts: Record<string, string> = {};
  for (const kv of header.split(",")) {
    const idx = kv.indexOf("=");
    if (idx > 0) parts[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  }
  const t = parseInt(parts["t"] ?? "", 10);
  const v1 = parts["v1"] ?? "";
  if (!Number.isFinite(t) || !v1) return false;
  if (Math.abs(nowSec() - t) > 300) return false;
  const expected = await hmacSha256Hex(secret, `${t}.${rawBody}`);
  return timingSafeEqual(expected, v1);
}

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

/** Stripe subscription.status → our SubscriptionStatus. */
export function mapStripeStatus(status: unknown): SubscriptionStatus {
  switch (status) {
    case "trialing":
      return SubscriptionStatus.Trialing;
    case "active":
      return SubscriptionStatus.Active;
    case "past_due":
    case "incomplete":
    case "unpaid":
      return SubscriptionStatus.PastDue;
    case "canceled":
      return SubscriptionStatus.Canceled;
    case "incomplete_expired":
      return SubscriptionStatus.Expired;
    default:
      return SubscriptionStatus.PastDue;
  }
}

interface StripeSubLike {
  id: string;
  status: unknown;
  current_period_end?: unknown;
  customer?: unknown;
  items?: { data?: { price?: { id?: unknown } }[] };
}

async function findPlanByStripePrice(
  db: Db,
  priceId: string,
): Promise<PlanRow | null> {
  const active = await listActivePlans(db);
  for (const p of active) {
    if (providerRefs(p)["stripe"] === priceId) return p;
  }
  return null;
}

function stripePriceId(sub: StripeSubLike): string | null {
  const id = sub.items?.data?.[0]?.price?.id;
  return typeof id === "string" ? id : null;
}

async function upsertFromStripeSub(
  db: Db,
  userId: string,
  sub: StripeSubLike,
  customerId: string | null,
  planIdHint?: string | null,
): Promise<SubscriptionRow> {
  const now = nowSec();
  const status = mapStripeStatus(sub.status);
  const periodEnd =
    typeof sub.current_period_end === "number"
      ? (sub.current_period_end as number)
      : null;
  const existing =
    (await getSubscriptionByProviderRef(db, sub.id)) ??
    (await getLiveSubscriptionByUser(db, userId));

  if (existing) {
    // The provider is the source of truth: apply its status. The state
    // machine guards our own transitions; an illegal edge here only means
    // our model lagged behind Stripe, so we still apply it.
    const legal = transitionSubscription(existing.status, status);
    if (!legal)
      console.warn(
        `stripe: unexpected transition ${existing.status} -> ${status}`,
      );
    await updateSubscription(db, existing.id, {
      status,
      currentPeriodEnd: periodEnd,
      providerRef: sub.id,
      providerCustomerId: customerId ?? existing.providerCustomerId,
      planId: planIdHint ?? existing.planId,
      graceUntil:
        status === SubscriptionStatus.PastDue
          ? existing.graceUntil && existing.graceUntil > now
            ? existing.graceUntil
            : now + GRACE_PERIOD_SEC
          : status === SubscriptionStatus.Active
            ? null
            : existing.graceUntil,
    });
    return (await getSubscriptionByProviderRef(db, sub.id)) as SubscriptionRow;
  }

  if (!planIdHint) throw new Error("cannot map stripe subscription to a plan");
  return createSubscription(db, {
    userId,
    planId: planIdHint,
    status,
    provider: "stripe",
    providerRef: sub.id,
    providerCustomerId: customerId,
    currentPeriodEnd: periodEnd,
    graceUntil:
      status === SubscriptionStatus.PastDue ? now + GRACE_PERIOD_SEC : null,
  });
}

async function stripeGetSubscription(
  env: Env,
  subId: string,
): Promise<StripeSubLike> {
  const s = await stripeApi(
    env,
    "GET",
    `/v1/subscriptions/${encodeURIComponent(subId)}`,
  );
  return s as unknown as StripeSubLike;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

/**
 * Handle a verified Stripe event. Idempotency is enforced by the caller
 * (payment_events.provider_event_id UNIQUE) — this function only mutates.
 */
export async function handleStripeEvent(
  db: Db,
  env: Env,
  event: StripeEvent,
): Promise<void> {
  const obj = event.data.object;
  switch (event.type) {
    case "checkout.session.completed": {
      const userId =
        str(obj["client_reference_id"]) ??
        str(
          (obj["metadata"] as Record<string, unknown> | undefined)?.["user_id"],
        );
      const subId = str(obj["subscription"]);
      const customerId = str(obj["customer"]);
      if (!userId || !subId) return;
      const sub = await stripeGetSubscription(env, subId);
      const priceId = stripePriceId(sub);
      const plan = priceId ? await findPlanByStripePrice(db, priceId) : null;
      await upsertFromStripeSub(db, userId, sub, customerId, plan?.id ?? null);
      break;
    }
    case "invoice.paid": {
      const subId = str(obj["subscription"]);
      const userId = str(
        (obj["metadata"] as Record<string, unknown> | undefined)?.["user_id"],
      );
      if (!subId) return;
      const sub = await stripeGetSubscription(env, subId);
      const existing = await getSubscriptionByProviderRef(db, sub.id);
      const uid = userId ?? existing?.userId;
      if (!uid) return;
      const priceId = stripePriceId(sub);
      const plan = priceId ? await findPlanByStripePrice(db, priceId) : null;
      await upsertFromStripeSub(
        db,
        uid,
        sub,
        str(obj["customer"]),
        existing?.planId ?? plan?.id ?? null,
      );
      break;
    }
    case "invoice.payment_failed": {
      const subId = str(obj["subscription"]);
      if (!subId) return;
      const sub = await stripeGetSubscription(env, subId);
      const now = nowSec();
      const existing = await getSubscriptionByProviderRef(db, sub.id);
      if (!existing) return;
      await updateSubscription(db, existing.id, {
        status: SubscriptionStatus.PastDue,
        currentPeriodEnd:
          typeof sub.current_period_end === "number"
            ? (sub.current_period_end as number)
            : existing.currentPeriodEnd,
        graceUntil: now + GRACE_PERIOD_SEC,
      });
      break;
    }
    case "customer.subscription.updated": {
      const existing = await getSubscriptionByProviderRef(
        db,
        str(obj["id"]) ?? "",
      );
      if (!existing) return;
      const status = mapStripeStatus(obj["status"]);
      const now = nowSec();
      await updateSubscription(db, existing.id, {
        status,
        currentPeriodEnd:
          typeof obj["current_period_end"] === "number"
            ? (obj["current_period_end"] as number)
            : existing.currentPeriodEnd,
        graceUntil:
          status === SubscriptionStatus.PastDue
            ? existing.graceUntil && existing.graceUntil > now
              ? existing.graceUntil
              : now + GRACE_PERIOD_SEC
            : status === SubscriptionStatus.Active
              ? null
              : existing.graceUntil,
      });
      break;
    }
    case "customer.subscription.deleted": {
      const existing = await getSubscriptionByProviderRef(
        db,
        str(obj["id"]) ?? "",
      );
      if (!existing) return;
      await updateSubscription(db, existing.id, {
        status: SubscriptionStatus.Canceled,
        graceUntil: null,
      });
      break;
    }
    case "charge.refunded": {
      // Recorded in payment_events by the caller; no subscription change.
      break;
    }
    case "charge.dispute.created": {
      const userId = str(
        (obj["metadata"] as Record<string, unknown> | undefined)?.["user_id"],
      );
      if (userId) {
        await addAbuseFlag(
          db,
          userId,
          "stripe_dispute",
          `charge dispute ${str(obj["id"]) ?? "unknown"}`,
        );
      }
      break;
    }
    default:
      // Unknown event types are recorded (payment_events) but not acted on.
      break;
  }
}

/** Extract a best-effort amount/currency from a Stripe event object. */
export function stripeAmountOf(event: StripeEvent): {
  amountCents: number | null;
  currency: string | null;
} {
  const obj = event.data.object;
  const amount =
    typeof obj["amount_due"] === "number"
      ? (obj["amount_due"] as number)
      : typeof obj["amount"] === "number"
        ? (obj["amount"] as number)
        : null;
  const currency =
    typeof obj["currency"] === "string"
      ? (obj["currency"] as string).toUpperCase()
      : null;
  return { amountCents: amount, currency };
}
