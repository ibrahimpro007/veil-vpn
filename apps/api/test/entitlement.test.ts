import { describe, it, expect } from "vitest";
import { SubscriptionStatus } from "@veil/shared";
import {
  computeEntitlement,
  transitionSubscription,
  GRACE_PERIOD_SEC,
} from "../src/entitlement.js";

const NOW = 1_800_000_000;
const UID = "user_1";
const PLAN = { id: "plan_monthly", slug: "monthly", deviceLimit: 5 };

function sub(over: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    userId: UID,
    planId: PLAN.id,
    status: SubscriptionStatus.Active,
    currentPeriodEnd: NOW + 86400,
    graceUntil: null,
    provider: "stripe",
    ...over,
  };
}

describe("computeEntitlement", () => {
  it("entitles active subscriptions with a future period end", () => {
    const e = computeEntitlement(UID, sub(), PLAN, NOW);
    expect(e.canConnect).toBe(true);
    expect(e.status).toBe(SubscriptionStatus.Active);
    expect(e.deviceLimit).toBe(5);
    expect(e.planSlug).toBe("monthly");
  });

  it("entitles trialing subscriptions", () => {
    const e = computeEntitlement(
      UID,
      sub({ status: SubscriptionStatus.Trialing }),
      PLAN,
      NOW,
    );
    expect(e.canConnect).toBe(true);
  });

  it("does not entitle active subscriptions past period end", () => {
    const e = computeEntitlement(
      UID,
      sub({ currentPeriodEnd: NOW - 10 }),
      PLAN,
      NOW,
    );
    expect(e.canConnect).toBe(false);
  });

  it("entitles past_due within grace_until", () => {
    const e = computeEntitlement(
      UID,
      sub({ status: SubscriptionStatus.PastDue, graceUntil: NOW + 1000 }),
      PLAN,
      NOW,
    );
    expect(e.canConnect).toBe(true);
    expect(e.graceUntil).toBe(NOW + 1000);
  });

  it("falls back to period end + 3 days when grace_until is null", () => {
    const inGrace = computeEntitlement(
      UID,
      sub({
        status: SubscriptionStatus.PastDue,
        currentPeriodEnd: NOW - 1000,
        graceUntil: null,
      }),
      PLAN,
      NOW,
    );
    expect(inGrace.canConnect).toBe(true);
    expect(inGrace.graceUntil).toBe(NOW - 1000 + GRACE_PERIOD_SEC);

    const outOfGrace = computeEntitlement(
      UID,
      sub({
        status: SubscriptionStatus.PastDue,
        currentPeriodEnd: NOW - GRACE_PERIOD_SEC - 1,
        graceUntil: null,
      }),
      PLAN,
      NOW,
    );
    expect(outOfGrace.canConnect).toBe(false);
  });

  it("does not entitle past_due past grace", () => {
    const e = computeEntitlement(
      UID,
      sub({ status: SubscriptionStatus.PastDue, graceUntil: NOW - 1 }),
      PLAN,
      NOW,
    );
    expect(e.canConnect).toBe(false);
  });

  it("does not entitle canceled or expired subscriptions", () => {
    for (const status of [
      SubscriptionStatus.Canceled,
      SubscriptionStatus.Expired,
    ]) {
      const e = computeEntitlement(UID, sub({ status }), PLAN, NOW);
      expect(e.canConnect).toBe(false);
    }
  });

  it("does not entitle users without a subscription", () => {
    const e = computeEntitlement(UID, null, null, NOW);
    expect(e.canConnect).toBe(false);
    expect(e.deviceLimit).toBe(0);
  });

  it("never trusts client flags — only the subscription row matters", () => {
    // Even if a caller forged canConnect=true somewhere, recomputing from
    // the row yields the truth.
    const e = computeEntitlement(
      UID,
      sub({ status: SubscriptionStatus.Expired }),
      PLAN,
      NOW,
    );
    expect(e.canConnect).toBe(false);
  });
});

describe("transitionSubscription", () => {
  it("allows documented transitions", () => {
    expect(transitionSubscription("trialing", "active")).toBe("active");
    expect(transitionSubscription("active", "past_due")).toBe("past_due");
    expect(transitionSubscription("past_due", "active")).toBe("active");
    expect(transitionSubscription("active", "canceled")).toBe("canceled");
    expect(transitionSubscription("canceled", "active")).toBe("active");
    expect(transitionSubscription("expired", "trialing")).toBe("trialing");
    expect(transitionSubscription("active", "active")).toBe("active"); // renewal
  });

  it("rejects illegal transitions", () => {
    expect(transitionSubscription("canceled", "past_due")).toBeNull();
    expect(transitionSubscription("expired", "past_due")).toBeNull();
    expect(transitionSubscription("trialing", "trialing")).toBeNull();
    expect(transitionSubscription("bogus", "active")).toBeNull();
  });
});
