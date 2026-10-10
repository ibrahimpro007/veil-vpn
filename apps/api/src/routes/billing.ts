import { checkoutCreateSchema, portalCreateSchema } from "@veil/shared";
import type { Subscription } from "@veil/shared";
import type { App } from "../app.js";
import { makeDb } from "../db/index.js";
import { getLiveSubscriptionByUser, getPlanById } from "../db/queries.js";
import { computeEntitlement } from "../entitlement.js";
import { StripeAdapter } from "../payments/stripe.js";
import { LemonSqueezyAdapter } from "../payments/lemonsqueezy.js";
import {
  PortalUnsupportedError,
  type PaymentProvider,
} from "../payments/provider.js";
import { requireUser } from "../middleware/auth.js";
import { apiError, validationError } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rateLimit.js";
import { nowSec } from "../util/crypto.js";

function toSubscription(
  s: {
    id: string;
    planId: string;
    status: string;
    currentPeriodEnd: number | null;
    graceUntil: number | null;
    provider: string;
  },
  planSlug: string,
): Subscription {
  return {
    id: s.id,
    planId: s.planId,
    planSlug,
    status: s.status as Subscription["status"],
    currentPeriodEnd: s.currentPeriodEnd,
    graceUntil: s.graceUntil,
    provider: s.provider as Subscription["provider"],
  };
}

function providerFor(name: "stripe" | "lemonsqueezy"): PaymentProvider {
  return name === "stripe" ? new StripeAdapter() : new LemonSqueezyAdapter();
}

export function registerBillingRoutes(app: App): void {
  /** GET /v1/subscription — current subscription + server-computed entitlement. */
  app.get("/v1/subscription", requireUser, async (c) => {
    const db = makeDb(c.env.DB);
    const user = c.get("authUser")!;
    const sub = await getLiveSubscriptionByUser(db, user.id);
    const plan = sub ? await getPlanById(db, sub.planId) : null;
    const entitlement = computeEntitlement(
      user.id,
      sub ?? null,
      plan ?? null,
      nowSec(),
    );
    return c.json({
      subscription: sub ? toSubscription(sub, plan?.slug ?? "unknown") : null,
      entitlement,
    });
  });

  /** POST /v1/billing/checkout — create a provider checkout session. */
  app.post(
    "/v1/billing/checkout",
    requireUser,
    rateLimit("checkout", 20, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = checkoutCreateSchema.safeParse(body);
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = c.get("authUser")!;
      const plan = await getPlanById(db, parsed.data.planId);
      if (!plan || plan.active !== 1) {
        return apiError(c, 404, "not_found", "Plan not found.");
      }
      if (plan.priceCents === 0) {
        return apiError(
          c,
          400,
          "invalid_plan",
          "This plan cannot be purchased.",
        );
      }
      try {
        const { url } = await providerFor(parsed.data.provider).createCheckout({
          user: { id: user.id, email: user.email },
          plan,
          env: c.env,
        });
        return c.json({ checkoutUrl: url });
      } catch (err) {
        return apiError(
          c,
          502,
          "provider_error",
          "Could not create a checkout session. Try again.",
        );
      }
    },
  );

  /** POST /v1/billing/portal — customer self-service billing portal. */
  app.post(
    "/v1/billing/portal",
    requireUser,
    rateLimit("portal", 20, 3600),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = portalCreateSchema.safeParse(body ?? {});
      if (!parsed.success) return validationError(c, parsed.error.issues);
      const db = makeDb(c.env.DB);
      const user = c.get("authUser")!;
      const sub = await getLiveSubscriptionByUser(db, user.id);
      if (
        !sub ||
        (sub.provider !== "stripe" && sub.provider !== "lemonsqueezy")
      ) {
        return apiError(c, 404, "not_found", "No billing customer on file.");
      }
      try {
        const { url } = await providerFor(
          sub.provider as "stripe" | "lemonsqueezy",
        ).createPortal({
          subscription: sub,
          env: c.env,
        });
        return c.json({ portalUrl: url });
      } catch (err) {
        if (err instanceof PortalUnsupportedError) {
          return apiError(
            c,
            404,
            "portal_unsupported",
            "Self-service billing is not available for this provider. Use the links in your receipt emails.",
          );
        }
        return apiError(
          c,
          502,
          "provider_error",
          "Could not create a portal session. Try again.",
        );
      }
    },
  );
}
