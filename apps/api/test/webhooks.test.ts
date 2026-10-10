import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { makeTestContext, treqRaw, type TestContext } from "./helpers.js";
import { createUser, createSubscription } from "../src/db/queries.js";
import { hashPassword, hmacSha256Hex, nowSec } from "../src/util/crypto.js";
import { paymentEvents, subscriptions } from "../src/db/schema.js";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await makeTestContext();
});

/** Intercept Stripe REST calls made by the webhook handler. */
function mockStripeApi(sub: Record<string, unknown>) {
  const real = globalThis.fetch;
  globalThis.fetch = (async (input: unknown, init?: unknown) => {
    const url = String(input);
    if (url.startsWith("https://api.stripe.com/v1/subscriptions/")) {
      return new Response(JSON.stringify(sub), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return (real as typeof fetch)(input as never, init as never);
  }) as typeof fetch;
  return () => {
    globalThis.fetch = real;
  };
}

async function signStripe(rawBody: string): Promise<string> {
  const t = nowSec();
  const v1 = await hmacSha256Hex(
    ctx.env.STRIPE_WEBHOOK_SECRET,
    `${t}.${rawBody}`,
  );
  return `t=${t},v1=${v1}`;
}

describe("stripe webhooks", () => {
  it("processes invoice.payment_failed exactly once (idempotent)", async () => {
    const user = await createUser(ctx.db, {
      email: "pay@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    await createSubscription(ctx.db, {
      userId: user.id,
      planId: "plan_monthly",
      status: "active",
      provider: "stripe",
      providerRef: "sub_123",
      providerCustomerId: "cus_123",
      currentPeriodEnd: nowSec() + 86400,
    });

    const restore = mockStripeApi({
      id: "sub_123",
      status: "past_due",
      current_period_end: nowSec() + 86400,
      customer: "cus_123",
    });
    try {
      const rawBody = JSON.stringify({
        id: "evt_1",
        type: "invoice.payment_failed",
        data: {
          object: {
            id: "in_1",
            subscription: "sub_123",
            customer: "cus_123",
            amount_due: 499,
            currency: "usd",
          },
        },
      });
      const headers = { "stripe-signature": await signStripe(rawBody) };

      const r1 = await treqRaw(ctx, "POST", "/v1/webhooks/stripe", rawBody, {
        headers,
      });
      expect(r1.status).toBe(200);
      expect((r1.json as { duplicate?: boolean }).duplicate).toBeUndefined();

      // Same event delivered again → 200, marked duplicate, not re-processed.
      const r2 = await treqRaw(ctx, "POST", "/v1/webhooks/stripe", rawBody, {
        headers,
      });
      expect(r2.status).toBe(200);
      expect((r2.json as { duplicate?: boolean }).duplicate).toBe(true);

      // Exactly one payment_events row and one subscription row.
      const events = await ctx.db.select().from(paymentEvents);
      expect(events).toHaveLength(1);
      expect(events[0].providerEventId).toBe("evt_1");
      expect(events[0].type).toBe("invoice.payment_failed");
      expect(events[0].amountCents).toBe(499);
      expect(events[0].rawHash).toMatch(/^[a-f0-9]{64}$/);

      const subs = await ctx.db.select().from(subscriptions);
      expect(subs).toHaveLength(1);
      expect(subs[0].status).toBe("past_due");
      expect(subs[0].graceUntil).toBeGreaterThan(nowSec());
      expect(subs[0].graceUntil).toBeLessThanOrEqual(nowSec() + 3 * 86400 + 5);
    } finally {
      restore();
    }
  });

  it("rejects bad signatures with 400 and records nothing", async () => {
    const rawBody = JSON.stringify({
      id: "evt_x",
      type: "invoice.paid",
      data: { object: {} },
    });
    const r = await treqRaw(ctx, "POST", "/v1/webhooks/stripe", rawBody, {
      headers: { "stripe-signature": "t=123,v1=deadbeef" },
    });
    expect(r.status).toBe(400);
    expect((r.json as { error: { code: string } }).error.code).toBe(
      "invalid_signature",
    );
    const events = await ctx.db.select().from(paymentEvents);
    expect(events).toHaveLength(0);
  });

  it("rejects stale timestamps", async () => {
    const rawBody = JSON.stringify({
      id: "evt_y",
      type: "invoice.paid",
      data: { object: {} },
    });
    const v1 = await hmacSha256Hex(
      ctx.env.STRIPE_WEBHOOK_SECRET,
      `${nowSec() - 3600}.${rawBody}`,
    );
    const r = await treqRaw(ctx, "POST", "/v1/webhooks/stripe", rawBody, {
      headers: { "stripe-signature": `t=${nowSec() - 3600},v1=${v1}` },
    });
    expect(r.status).toBe(400);
  });

  it("handles checkout.session.completed end to end", async () => {
    const user = await createUser(ctx.db, {
      email: "checkout@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    // Map the price to the monthly plan.
    await ctx.d1
      .prepare(
        "UPDATE plans SET provider_product_refs = ?1 WHERE id = 'plan_monthly'",
      )
      .bind(JSON.stringify({ stripe: "price_monthly_499" }))
      .run();

    const restore = mockStripeApi({
      id: "sub_new_1",
      status: "active",
      current_period_end: nowSec() + 30 * 86400,
      customer: "cus_new_1",
      items: { data: [{ price: { id: "price_monthly_499" } }] },
    });
    try {
      const rawBody = JSON.stringify({
        id: "evt_checkout_1",
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_1",
            client_reference_id: user.id,
            customer: "cus_new_1",
            subscription: "sub_new_1",
            metadata: { user_id: user.id },
          },
        },
      });
      const r = await treqRaw(ctx, "POST", "/v1/webhooks/stripe", rawBody, {
        headers: { "stripe-signature": await signStripe(rawBody) },
      });
      expect(r.status).toBe(200);
      const subs = await ctx.db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.userId, user.id));
      expect(subs).toHaveLength(1);
      expect(subs[0].status).toBe("active");
      expect(subs[0].planId).toBe("plan_monthly");
      expect(subs[0].providerRef).toBe("sub_new_1");
      expect(subs[0].providerCustomerId).toBe("cus_new_1");
    } finally {
      restore();
    }
  });
});

describe("lemonsqueezy webhooks", () => {
  async function signLemon(rawBody: string): Promise<string> {
    return hmacSha256Hex(ctx.env.LEMONSQUEEZY_WEBHOOK_SECRET, rawBody);
  }

  it("processes subscription_created idempotently", async () => {
    const user = await createUser(ctx.db, {
      email: "lemon@example.com",
      passwordHash: await hashPassword("correct-horse-12"),
    });
    await ctx.d1
      .prepare(
        "UPDATE plans SET provider_product_refs = ?1 WHERE id = 'plan_yearly'",
      )
      .bind(JSON.stringify({ lemonsqueezy: "variant_yearly_1" }))
      .run();

    const payload = {
      meta: {
        event_name: "subscription_created",
        custom_data: { user_id: user.id },
      },
      data: {
        id: "12345",
        type: "subscriptions",
        attributes: {
          status: "active",
          variant_id: "variant_yearly_1",
          customer_id: 999,
          ends_at: new Date((nowSec() + 365 * 86400) * 1000).toISOString(),
        },
      },
    };
    const rawBody = JSON.stringify(payload);
    const headers = { "x-signature": await signLemon(rawBody) };

    const r1 = await treqRaw(
      ctx,
      "POST",
      "/v1/webhooks/lemonsqueezy",
      rawBody,
      { headers },
    );
    expect(r1.status).toBe(200);
    const r2 = await treqRaw(
      ctx,
      "POST",
      "/v1/webhooks/lemonsqueezy",
      rawBody,
      { headers },
    );
    expect(r2.status).toBe(200);
    expect((r2.json as { duplicate?: boolean }).duplicate).toBe(true);

    const subs = await ctx.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, user.id));
    expect(subs).toHaveLength(1);
    expect(subs[0].status).toBe("active");
    expect(subs[0].planId).toBe("plan_yearly");
    expect(subs[0].provider).toBe("lemonsqueezy");
  });

  it("rejects bad x-signature", async () => {
    const rawBody = JSON.stringify({
      meta: { event_name: "x" },
      data: { id: "1" },
    });
    const r = await treqRaw(ctx, "POST", "/v1/webhooks/lemonsqueezy", rawBody, {
      headers: { "x-signature": "deadbeef" },
    });
    expect(r.status).toBe(400);
  });
});
