/**
 * LemonSqueezy adapter: checkouts via the Lemon Squeezy REST API and webhook
 * verification/handling.
 *
 * When to choose LemonSqueezy over Stripe: it is a merchant of record — it
 * handles global VAT/sales-tax collection and remittance for you — which
 * makes it the pragmatic choice in countries where Stripe is unavailable or
 * where you don't want to deal with tax nexus yourself. The PaymentProvider
 * interface keeps both behind the same checkout/portal/webhook surface.
 *
 * Note: Lemon Squeezy has no customer-portal-session API. createPortal
 * therefore throws PortalUnsupportedError and the route answers 404 with
 * guidance (customers manage subscriptions from the receipt email links).
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

async function lemonApi(
  env: Env,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.lemonsqueezy.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
      Accept: "application/vnd.api+json",
      "Content-Type": "application/vnd.api+json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `lemonsqueezy ${method} ${path} failed (${res.status}): ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

export class LemonSqueezyAdapter implements PaymentProvider {
  readonly providerName = "lemonsqueezy" as const;

  async createCheckout({
    user,
    plan,
    env,
  }: CheckoutArgs): Promise<{ url: string }> {
    const variantId = providerRefs(plan)["lemonsqueezy"];
    if (!variantId)
      throw new Error(`plan ${plan.slug} is not configured for LemonSqueezy`);
    const res = await lemonApi(env, "POST", "/v1/checkouts", {
      data: {
        type: "checkouts",
        attributes: {
          checkout_data: {
            email: user.email,
            custom: { user_id: user.id },
          },
          product_options: {
            redirect_url: `${env.APP_URL}/billing/success`,
          },
        },
        relationships: {
          store: { data: { type: "stores", id: env.LEMONSQUEEZY_STORE_ID } },
          variant: { data: { type: "variants", id: variantId } },
        },
      },
    });
    const url = (res["data"] as Record<string, unknown> | undefined)?.[
      "attributes"
    ] as Record<string, unknown> | undefined;
    if (typeof url?.["url"] !== "string")
      throw new Error("lemonsqueezy did not return a checkout url");
    return { url: url["url"] as string };
  }

  async createPortal(_args: PortalArgs): Promise<{ url: string }> {
    throw new PortalUnsupportedError("lemonsqueezy");
  }

  async verifyWebhook(
    rawBody: string,
    headers: Headers,
    env: Env,
  ): Promise<boolean> {
    const sig = headers.get("x-signature");
    if (!sig || !env.LEMONSQUEEZY_WEBHOOK_SECRET) return false;
    const expected = await hmacSha256Hex(
      env.LEMONSQUEEZY_WEBHOOK_SECRET,
      rawBody,
    );
    return timingSafeEqual(expected, sig);
  }
}

/** LemonSqueezy webhook payload shape (subset we use). */
export interface LemonEvent {
  meta: {
    event_name: string;
    custom_data?: { user_id?: string };
  };
  data: {
    id: string;
    type: string;
    attributes: Record<string, unknown>;
  };
}

export function mapLemonStatus(status: unknown): SubscriptionStatus {
  switch (status) {
    case "on_trial":
      return SubscriptionStatus.Trialing;
    case "active":
      return SubscriptionStatus.Active;
    case "past_due":
    case "unpaid":
    case "paused":
      return SubscriptionStatus.PastDue;
    case "cancelled":
      return SubscriptionStatus.Canceled;
    case "expired":
      return SubscriptionStatus.Expired;
    default:
      return SubscriptionStatus.PastDue;
  }
}

function isoToSec(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.floor(t / 1000) : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

async function findPlanByLemonVariant(
  db: Db,
  variantId: string,
): Promise<PlanRow | null> {
  const active = await listActivePlans(db);
  for (const p of active) {
    if (providerRefs(p)["lemonsqueezy"] === variantId) return p;
  }
  return null;
}

async function upsertLemonSubscription(
  db: Db,
  userId: string,
  event: LemonEvent,
): Promise<SubscriptionRow | null> {
  const attrs = event.data.attributes;
  const status = mapLemonStatus(attrs["status"]);
  const now = nowSec();
  const periodEnd = isoToSec(attrs["ends_at"]);
  const providerRef = `ls_${event.data.id}`;
  const customerId =
    attrs["customer_id"] != null ? String(attrs["customer_id"]) : null;
  const variantId = str(attrs["variant_id"]);
  const plan = variantId ? await findPlanByLemonVariant(db, variantId) : null;

  const existing =
    (await getSubscriptionByProviderRef(db, providerRef)) ??
    (await getLiveSubscriptionByUser(db, userId));
  if (existing) {
    const legal = transitionSubscription(existing.status, status);
    if (!legal)
      console.warn(
        `lemonsqueezy: unexpected transition ${existing.status} -> ${status}`,
      );
    await updateSubscription(db, existing.id, {
      status,
      currentPeriodEnd: periodEnd ?? existing.currentPeriodEnd,
      providerRef,
      providerCustomerId: customerId ?? existing.providerCustomerId,
      planId: plan?.id ?? existing.planId,
      graceUntil:
        status === SubscriptionStatus.PastDue
          ? existing.graceUntil && existing.graceUntil > now
            ? existing.graceUntil
            : now + GRACE_PERIOD_SEC
          : status === SubscriptionStatus.Active
            ? null
            : existing.graceUntil,
    });
    return (await getSubscriptionByProviderRef(
      db,
      providerRef,
    )) as SubscriptionRow;
  }
  if (!plan) return null; // unknown variant — recorded in payment_events, not acted on
  return createSubscription(db, {
    userId,
    planId: plan.id,
    status,
    provider: "lemonsqueezy",
    providerRef,
    providerCustomerId: customerId,
    currentPeriodEnd: periodEnd,
    graceUntil:
      status === SubscriptionStatus.PastDue ? now + GRACE_PERIOD_SEC : null,
  });
}

/** Handle a verified LemonSqueezy webhook. Idempotency enforced by caller. */
export async function handleLemonEvent(
  db: Db,
  event: LemonEvent,
): Promise<SubscriptionRow | null> {
  const name = event.meta.event_name;
  const userId = event.meta.custom_data?.user_id;
  switch (name) {
    case "subscription_created":
    case "subscription_updated":
    case "subscription_resumed":
    case "subscription_unpaused":
      if (!userId) return null;
      return upsertLemonSubscription(db, userId, event);
    case "subscription_payment_failed":
    case "subscription_paused": {
      if (!userId) return null;
      const sub = await upsertLemonSubscription(db, userId, event);
      if (sub) {
        const now = nowSec();
        await updateSubscription(db, sub.id, {
          status: SubscriptionStatus.PastDue,
          graceUntil:
            sub.graceUntil && sub.graceUntil > now
              ? sub.graceUntil
              : now + GRACE_PERIOD_SEC,
        });
      }
      return sub;
    }
    case "subscription_cancelled":
      if (!userId) return null;
      return upsertLemonSubscription(db, userId, event);
    case "subscription_expired": {
      if (!userId) return null;
      const sub = await upsertLemonSubscription(db, userId, event);
      if (sub)
        await updateSubscription(db, sub.id, {
          status: SubscriptionStatus.Expired,
          graceUntil: null,
        });
      return sub;
    }
    case "order_created":
    default:
      // One-time orders / unknown events: recorded in payment_events only.
      return null;
  }
}

/** Best-effort amount/currency extraction for the payment_events row. */
export function lemonAmountOf(event: LemonEvent): {
  amountCents: number | null;
  currency: string | null;
} {
  const attrs = event.data.attributes;
  const total = attrs["total"];
  const amountCents = typeof total === "number" ? total : null;
  const currency =
    typeof attrs["currency"] === "string"
      ? (attrs["currency"] as string).toUpperCase()
      : null;
  return { amountCents, currency };
}
