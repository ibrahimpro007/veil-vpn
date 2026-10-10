import { SubscriptionStatus } from "@veil/shared";
import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import {
  insertPaymentEventOnce,
  listActivePlans,
  findUserById,
} from "../db/queries.js";
import { sha256Hex, nowSec } from "../util/crypto.js";
import { apiError } from "../middleware/errors.js";
import {
  StripeAdapter,
  handleStripeEvent,
  stripeAmountOf,
  type StripeEvent,
} from "../payments/stripe.js";
import {
  LemonSqueezyAdapter,
  handleLemonEvent,
  lemonAmountOf,
  type LemonEvent,
} from "../payments/lemonsqueezy.js";
import { verifyPlayPurchase, parseRtdn } from "../payments/play.js";
import { verifyStoreKitJws } from "../payments/storekit.js";
import { upsertProviderSubscription } from "../payments/upsert.js";
import { providerRefs } from "../payments/provider.js";

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

async function findPlanByProviderRef(
  db: ReturnType<typeof makeDb>,
  provider: string,
  ref: string,
): Promise<{ id: string } | null> {
  const active = await listActivePlans(db);
  for (const p of active) {
    if (providerRefs(p)[provider] === ref) return { id: p.id };
  }
  return null;
}

export function registerWebhookRoutes(app: App): void {
  /**
   * POST /v1/webhooks/stripe — signature-verified, idempotent.
   * Idempotency: payment_events.provider_event_id UNIQUE; the insert happens
   * FIRST (ON CONFLICT DO NOTHING) so a retried delivery returns 200 without
   * re-processing. Only the sha256 of the raw payload is stored — never the
   * payload itself (no-logs).
   */
  app.post("/v1/webhooks/stripe", async (c) => {
    const rawBody = await c.req.text();
    const adapter = new StripeAdapter();
    if (!(await adapter.verifyWebhook(rawBody, c.req.raw.headers, c.env))) {
      return apiError(
        c,
        400,
        "invalid_signature",
        "Invalid webhook signature.",
      );
    }
    let event: StripeEvent;
    try {
      event = JSON.parse(rawBody) as StripeEvent;
    } catch {
      return apiError(c, 400, "invalid_payload", "Malformed webhook payload.");
    }
    if (!event.id || !event.type)
      return apiError(c, 400, "invalid_payload", "Malformed webhook payload.");
    const db = makeDb(c.env.DB);
    const { amountCents, currency } = stripeAmountOf(event);
    const first = await insertPaymentEventOnce(c.env.DB, {
      provider: "stripe",
      providerEventId: event.id,
      type: event.type,
      amountCents,
      currency,
      rawHash: await sha256Hex(rawBody),
    });
    if (!first) return c.json({ received: true, duplicate: true });
    try {
      await handleStripeEvent(db, c.env, event);
    } catch (err) {
      // The event is recorded; a failed handler must not make Stripe retry
      // into a duplicate-processing loop. The error is logged for the hourly
      // reconciliation to pick up.
      console.error(`stripe webhook handler failed for ${event.id}:`, err);
    }
    return c.json({ received: true });
  });

  /** POST /v1/webhooks/lemonsqueezy — same idempotency contract as Stripe. */
  app.post("/v1/webhooks/lemonsqueezy", async (c) => {
    const rawBody = await c.req.text();
    const adapter = new LemonSqueezyAdapter();
    if (!(await adapter.verifyWebhook(rawBody, c.req.raw.headers, c.env))) {
      return apiError(
        c,
        400,
        "invalid_signature",
        "Invalid webhook signature.",
      );
    }
    let event: LemonEvent;
    try {
      event = JSON.parse(rawBody) as LemonEvent;
    } catch {
      return apiError(c, 400, "invalid_payload", "Malformed webhook payload.");
    }
    const eventName = event.meta?.event_name;
    const dataId = event.data?.id;
    if (!eventName || !dataId)
      return apiError(c, 400, "invalid_payload", "Malformed webhook payload.");
    const rawHash = await sha256Hex(rawBody);
    // Include a payload-hash prefix so distinct events for the same object
    // don't collide, while identical redeliveries stay idempotent.
    const providerEventId = `ls:${eventName}:${dataId}:${rawHash.slice(0, 16)}`;
    const db = makeDb(c.env.DB);
    const { amountCents, currency } = lemonAmountOf(event);
    const first = await insertPaymentEventOnce(c.env.DB, {
      provider: "lemonsqueezy",
      providerEventId,
      type: eventName,
      userId: event.meta?.custom_data?.user_id ?? null,
      amountCents,
      currency,
      rawHash,
    });
    if (!first) return c.json({ received: true, duplicate: true });
    try {
      const sub = await handleLemonEvent(db, event);
      if (sub) {
        // Link the recorded event to the resulting subscription.
        const d1 = c.env.DB;
        await d1
          .prepare(
            "UPDATE payment_events SET subscription_id = ?1, user_id = ?2 WHERE provider_event_id = ?3",
          )
          .bind(sub.id, sub.userId, providerEventId)
          .run();
      }
    } catch (err) {
      console.error(
        `lemonsqueezy webhook handler failed for ${providerEventId}:`,
        err,
      );
    }
    return c.json({ received: true });
  });

  /**
   * POST /v1/webhooks/play — Google Play RTDN (Pub/Sub push). The RTDN
   * itself is unauthenticated; trust comes from verifying the purchase with
   * the Play Developer API. Attribution uses obfuscatedExternalAccountId
   * (the client sets obfuscatedAccountId = VeilVPN user id at purchase).
   */
  app.post("/v1/webhooks/play", async (c) => {
    const rawBody = await c.req.text();
    let envelope: unknown;
    try {
      envelope = JSON.parse(rawBody);
    } catch {
      return apiError(c, 400, "invalid_payload", "Malformed RTDN payload.");
    }
    const rtdn = parseRtdn(envelope as Parameters<typeof parseRtdn>[0]);
    if (!rtdn)
      return apiError(c, 400, "invalid_payload", "Malformed RTDN payload.");
    if (rtdn.testNotification) return c.json({ received: true, test: true });

    const sub = rtdn.subscriptionNotification;
    const oneTime = rtdn.oneTimeProductNotification;
    const notif = sub ?? oneTime;
    if (!notif) return c.json({ received: true, ignored: true });

    const messageId =
      (envelope as { message?: { messageId?: string } }).message?.messageId ??
      "unknown";
    const providerEventId = `play:${messageId}`;
    const db = makeDb(c.env.DB);
    const first = await insertPaymentEventOnce(c.env.DB, {
      provider: "play",
      providerEventId,
      type: sub
        ? `play.subscription.${notif.notificationType}`
        : `play.onetime.${notif.notificationType}`,
      rawHash: await sha256Hex(rawBody),
    });
    if (!first) return c.json({ received: true, duplicate: true });

    try {
      const productId = sub ? sub.subscriptionId : oneTime!.sku;
      const verification = await verifyPlayPurchase(
        c.env,
        rtdn.packageName,
        productId,
        notif.purchaseToken,
        sub ? "subs" : "inapp",
      );
      const userId = verification.obfuscatedAccountId;
      const user = userId ? await findUserById(db, userId) : undefined;
      if (user) {
        const matched = await findPlanByProviderRef(db, "play", productId);
        const fallback = (await listActivePlans(db))[0];
        const planId = matched?.id ?? fallback?.id;
        if (!planId) {
          console.error(
            "play webhook: no plans configured; cannot upsert subscription",
          );
          return c.json({ received: true });
        }
        const status = verification.ok
          ? SubscriptionStatus.Active
          : verification.purchaseState === 1
            ? SubscriptionStatus.Canceled
            : SubscriptionStatus.PastDue;
        const updated = await upsertProviderSubscription(db, {
          userId: user.id,
          planId,
          provider: "play",
          providerRef: `play:${notif.purchaseToken}`,
          status,
          currentPeriodEnd:
            verification.expiryTimeMillis != null
              ? Math.floor(verification.expiryTimeMillis / 1000)
              : null,
        });
        await c.env.DB.prepare(
          "UPDATE payment_events SET subscription_id = ?1, user_id = ?2 WHERE provider_event_id = ?3",
        )
          .bind(updated.id, user.id, providerEventId)
          .run();
      }
    } catch (err) {
      console.error(`play webhook handler failed for ${providerEventId}:`, err);
    }
    return c.json({ received: true });
  });

  /**
   * POST /v1/webhooks/storekit — App Store Server Notifications v2.
   * The signedPayload JWS is verified against Apple's certificate chain
   * (see payments/storekit.ts); attribution uses the transaction's
   * appAccountToken, which the client sets to the VeilVPN user id.
   */
  app.post("/v1/webhooks/storekit", async (c) => {
    const rawBody = await c.req.text();
    let body: { signedPayload?: string };
    try {
      body = JSON.parse(rawBody) as { signedPayload?: string };
    } catch {
      return apiError(
        c,
        400,
        "invalid_payload",
        "Malformed notification payload.",
      );
    }
    if (!body.signedPayload)
      return apiError(c, 400, "invalid_payload", "Missing signedPayload.");
    const verified = await verifyStoreKitJws(body.signedPayload);
    if (!verified.valid) {
      return apiError(
        c,
        400,
        "invalid_signature",
        "StoreKit signature verification failed.",
      );
    }
    const payload = verified.payload!;
    const notificationUUID = str(payload["notificationUUID"]) ?? "unknown";
    const providerEventId = `storekit:${notificationUUID}`;
    const db = makeDb(c.env.DB);
    const first = await insertPaymentEventOnce(c.env.DB, {
      provider: "storekit",
      providerEventId,
      type: str(payload["notificationType"]) ?? "unknown",
      rawHash: await sha256Hex(rawBody),
    });
    if (!first) return c.json({ received: true, duplicate: true });

    try {
      const data = payload["data"] as Record<string, unknown> | undefined;
      const signedTx = str(data?.["signedTransactionInfo"]);
      if (signedTx) {
        const txVerified = await verifyStoreKitJws(signedTx);
        if (txVerified.valid && txVerified.payload) {
          const tx = txVerified.payload;
          const userId = str(tx["appAccountToken"]);
          const productId = str(tx["productId"]);
          const user = userId ? await findUserById(db, userId) : undefined;
          if (user && productId) {
            const matched = await findPlanByProviderRef(
              db,
              "storekit",
              productId,
            );
            const fallback = (await listActivePlans(db))[0];
            const planId = matched?.id ?? fallback?.id;
            if (!planId) {
              console.error(
                "storekit webhook: no plans configured; cannot upsert subscription",
              );
              return c.json({ received: true });
            }
            const notificationType = str(payload["notificationType"]);
            const status = mapStoreKitStatus(notificationType, tx);
            const expiresDate =
              typeof tx["expiresDate"] === "number"
                ? (tx["expiresDate"] as number)
                : null;
            const updated = await upsertProviderSubscription(db, {
              userId: user.id,
              planId,
              provider: "storekit",
              providerRef: `storekit:${str(tx["transactionId"]) ?? notificationUUID}`,
              status,
              currentPeriodEnd:
                expiresDate != null ? Math.floor(expiresDate / 1000) : null,
            });
            await c.env.DB.prepare(
              "UPDATE payment_events SET subscription_id = ?1, user_id = ?2 WHERE provider_event_id = ?3",
            )
              .bind(updated.id, user.id, providerEventId)
              .run();
          }
        }
      }
    } catch (err) {
      console.error(
        `storekit webhook handler failed for ${providerEventId}:`,
        err,
      );
    }
    return c.json({ received: true });
  });
}

function mapStoreKitStatus(
  notificationType: string | null,
  tx: Record<string, unknown>,
): SubscriptionStatus {
  if (tx["revocationDate"] != null) return SubscriptionStatus.Canceled;
  switch (notificationType) {
    case "SUBSCRIBED":
    case "DID_RENEW":
    case "OFFER_REDEEMED":
      return SubscriptionStatus.Active;
    case "DID_FAIL_TO_RENEW":
    case "GRACE_PERIOD_EXPIRED":
      return SubscriptionStatus.PastDue;
    case "EXPIRED":
      return SubscriptionStatus.Expired;
    case "REFUND":
    case "REVOKE":
      return SubscriptionStatus.Canceled;
    default: {
      // Fall back to the transaction's own expiry.
      const expires =
        typeof tx["expiresDate"] === "number"
          ? (tx["expiresDate"] as number)
          : null;
      return expires != null && expires / 1000 > nowSec()
        ? SubscriptionStatus.Active
        : SubscriptionStatus.Expired;
    }
  }
}
