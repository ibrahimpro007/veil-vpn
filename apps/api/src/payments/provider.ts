/**
 * Payment provider abstraction. Web checkout (Stripe / LemonSqueezy) is the
 * only purchase path in the direct-download builds we ship ($0 budget);
 * mobile store verification lives in play.ts / storekit.ts and activates
 * only for store flavors.
 */
import type { Env } from "../env.js";
import type { PlanRow, SubscriptionRow } from "../db/queries.js";

export interface CheckoutArgs {
  user: { id: string; email: string };
  plan: PlanRow;
  env: Env;
}

export interface PortalArgs {
  subscription: SubscriptionRow;
  env: Env;
}

/** Thrown when a provider cannot offer a customer portal session. */
export class PortalUnsupportedError extends Error {
  constructor(provider: string) {
    super(`${provider} does not offer an API customer portal`);
    this.name = "PortalUnsupportedError";
  }
}

export interface PaymentProvider {
  readonly providerName: "stripe" | "lemonsqueezy";
  createCheckout(args: CheckoutArgs): Promise<{ url: string }>;
  createPortal(args: PortalArgs): Promise<{ url: string }>;
  /**
   * Verify the webhook signature over the RAW body. Returns false (never
   * throws) when the signature is missing or invalid.
   */
  verifyWebhook(rawBody: string, headers: Headers, env: Env): Promise<boolean>;
}

export function providerRefs(plan: PlanRow): Record<string, string> {
  try {
    return JSON.parse(plan.providerProductRefs) as Record<string, string>;
  } catch {
    return {};
  }
}
