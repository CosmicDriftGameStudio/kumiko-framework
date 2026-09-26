// Integration-test for the catalog-derived billing-plans query + the
// start-plan-checkout/switch-plan write-handlers (createBillingFoundationFeature
// with a `catalog`). Foundation-level routing/state-machine test — provider-
// specific behavior (real Stripe price/portal calls) is covered in
// subscription-stripe's own tests.
//
// Mock-provider strategy: same as billing-foundation.integration.test.ts's
// scenario 6/7 mock, extended with a `priceToTier` catalog + mutable
// isBillingEnabled/retrievePrices toggles so every spec branch (disabled,
// price-lookup failure, legacy inactive price, ...) is reachable per-test
// without a second setupTestStack.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import type { TenantDb } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { subscriptionAggregateId } from "../aggregate-id";
import { SubscriptionFoundationHandlers, SubscriptionStatuses } from "../constants";
import { createBillingFoundationFeature } from "../feature";
import { subscriptionsProjectionTable } from "../projection";
import type { BillingPlanCatalog, ProviderPrice, SubscriptionProviderPlugin } from "../types";

type PlanTier = "starter" | "pro";

const PRICE_TO_TIER: Readonly<Record<string, string>> = {
  price_starter: "starter",
  price_pro: "pro",
  price_pro_legacy: "pro",
  price_pilot: "pilot",
};

function stripePrice(
  overrides: Partial<ProviderPrice> & { readonly priceId: string },
): ProviderPrice {
  return {
    unitAmount: 1900,
    currency: "usd",
    interval: "month",
    intervalCount: 1,
    active: true,
    metadata: {},
    ...overrides,
  };
}

const PRICES: readonly ProviderPrice[] = [
  stripePrice({ priceId: "price_starter", unitAmount: 900 }),
  stripePrice({ priceId: "price_pro", unitAmount: 1900 }),
  // Legacy price for the same tier as price_pro — inactive, so resolvePlanPrices
  // still picks exactly one active flat-amount price for "pro" (price_pro).
  stripePrice({ priceId: "price_pro_legacy", unitAmount: 1500, active: false }),
];

let billingEnabled = true;
let retrievePricesMode: "ok" | "throw" = "ok";
const checkoutCalls: Array<{
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  providerCustomerId?: string;
}> = [];
const switchCalls: Array<{
  providerSubscriptionId: string;
  targetPriceId: string;
  allowedPriceIds: readonly string[];
  returnUrl: string;
}> = [];

const mockPlanProviderFeature = defineFeature("test-mock-plan-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
    priceToTier: PRICE_TO_TIER,
    isBillingEnabled: async () => billingEnabled,
    retrievePrices: async (_ctx, priceIds) => {
      if (retrievePricesMode === "throw") throw new Error("mock provider price lookup failed");
      return PRICES.filter((p) => priceIds.includes(p.priceId));
    },
    createCheckoutSession: async (_ctx, options) => {
      checkoutCalls.push({
        priceId: options.priceId,
        successUrl: options.successUrl,
        cancelUrl: options.cancelUrl,
        ...(options.providerCustomerId && { providerCustomerId: options.providerCustomerId }),
      });
      return { url: `https://mock.example/checkout/${options.priceId}` };
    },
    createPlanSwitchSession: async (_ctx, options) => {
      switchCalls.push(options);
      return { url: `https://mock.example/portal/switch/${options.targetPriceId}` };
    },
  };
  r.useExtension("subscriptionProvider", "mock-plan-provider", plugin);
});

// Second registered provider — exists only so a subscription can be created
// on a DIFFERENT provider than the catalog resolves, exercising switch-plan's
// providerMismatch conflict. Deliberately minimal: no priceToTier, so it
// never becomes the catalog's ambiguous default.
const mockOtherProviderFeature = defineFeature("test-mock-other-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async () => null,
  };
  r.useExtension("subscriptionProvider", "mock-other-provider", plugin);
});

/** Same shape as `BillingInfoQueryDeps.resolveTier` (spec): reads the
 *  subscription projection directly via `TenantDb`, no HandlerContext. A
 *  non-active/trialing subscription (or none at all) resolves to "free" —
 *  deliberately outside `catalog.plans`, matching a tenant that has never
 *  purchased a plan. */
async function resolveCurrentTier(db: TenantDb, tenantId: string): Promise<string> {
  const rows = await db.selectMany(
    subscriptionsProjectionTable,
    { id: subscriptionAggregateId(tenantId) },
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return "free";
  const status = row["status"] as string;
  const tier = row["tier"] as string;
  return status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing
    ? tier
    : "free";
}

function catalog(
  overrides: Partial<BillingPlanCatalog<PlanTier>> = {},
): BillingPlanCatalog<PlanTier> {
  return {
    plans: ["starter", "pro"],
    tierLabelKey: (tier) => `plan.${tier}.label`,
    benefits: (tier) => [{ labelKey: `plan.${tier}.benefit.core` }],
    resolveCurrentTier,
    viewRoles: ["TenantAdmin", "SystemAdmin"],
    successPath: "/billing/success",
    cancelPath: "/billing/cancel",
    providerName: "mock-plan-provider",
    ...overrides,
  };
}

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({ baseUrl: "https://app.example.com", catalog: catalog() }),
      mockPlanProviderFeature,
      mockOtherProviderFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

beforeEach(() => {
  billingEnabled = true;
  retrievePricesMode = "ok";
  checkoutCalls.length = 0;
  switchCalls.length = 0;
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function createSubscription(
  tenantId: string,
  overrides: Partial<{
    providerEventId: string;
    providerName: string;
    status: string;
    tier: string;
    providerSubscriptionId: string;
    providerCustomerId: string;
  }> = {},
) {
  const admin = createTestUser({ id: 0, tenantId, roles: ["TenantAdmin", "SystemAdmin"] });
  return stack.http.writeOk(
    SubscriptionFoundationHandlers.processEvent,
    {
      providerEventId: overrides.providerEventId ?? `evt_${tenantId}_create`,
      providerName: overrides.providerName ?? "mock-plan-provider",
      type: "subscription.created",
      providerCustomerId: overrides.providerCustomerId ?? `cus_${tenantId}`,
      providerSubscriptionId: overrides.providerSubscriptionId ?? `sub_${tenantId}`,
      status: overrides.status ?? SubscriptionStatuses.active,
      tier: overrides.tier ?? "starter",
      currentPeriodEndIso: "2026-06-01T00:00:00Z",
      rawPayload: '{"raw":"payload"}',
    },
    admin,
  );
}

// =============================================================================
// 1. No subscription — enabled, priced, checkout for both, canPurchase true.
// =============================================================================

describe("billing-plans query — no subscription", () => {
  test("both plans priced with checkout action, currentTier free", async () => {
    const admin = adminFor(7001);
    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      enabled: boolean;
      currentTier: { tier: string };
      canPurchase: boolean;
      subscription: unknown;
      plans: Array<{ tier: string; action: string; price: { unitAmount: number } | null }>;
    };

    expect(result.enabled).toBe(true);
    expect(result.currentTier.tier).toBe("free");
    expect(result.subscription).toBeNull();
    expect(result.canPurchase).toBe(true);
    expect(result.plans).toHaveLength(2);
    const starter = result.plans.find((p) => p.tier === "starter");
    const pro = result.plans.find((p) => p.tier === "pro");
    expect(starter?.action).toBe("checkout");
    expect(starter?.price?.unitAmount).toBe(900);
    expect(pro?.action).toBe("checkout");
    expect(pro?.price?.unitAmount).toBe(1900);
  });
});

// =============================================================================
// 2. start-plan-checkout — resolves the live (non-legacy) price + builds
//    baseUrl-origin URLs, preserving a baseUrl path-prefix.
// =============================================================================

describe("start-plan-checkout — no existing subscription", () => {
  test("pro tier resolves to price_pro (not the inactive legacy price), URLs use baseUrl + paths", async () => {
    const admin = adminFor(7002);
    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    )) as { url: string };

    expect(result.url).toBe("https://mock.example/checkout/price_pro");
    expect(checkoutCalls).toHaveLength(1);
    expect(checkoutCalls[0]).toEqual({
      priceId: "price_pro",
      successUrl: "https://app.example.com/billing/success",
      cancelUrl: "https://app.example.com/billing/cancel",
    });
  });
});

// =============================================================================
// 3. Tier outside catalog.plans is rejected by the zod enum before the handler runs.
// =============================================================================

describe("start-plan-checkout / switch-plan — tier outside the catalog", () => {
  test("start-plan-checkout rejects a tier not in catalog.plans", async () => {
    const admin = adminFor(7003);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pilot" },
      admin,
    );
    // Rejected by the zod z.enum(catalog.plans) schema before the handler runs.
    expect(error.httpStatus).toBe(400);
  });

  test("switch-plan rejects a tier not in catalog.plans", async () => {
    const admin = adminFor(7004);
    await createSubscription(admin.tenantId, { tier: "starter" });
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "free" },
      admin,
    );
    expect(error.httpStatus).toBe(400);
  });
});

// =============================================================================
// 4. Active non-terminal subscription — query shows current/switch, checkout
//    is blocked, payment-mode checkout on create-checkout-session stays open.
// =============================================================================

describe("active subscription — checkout blocked, switch offered", () => {
  test("query: starter is current, pro is switchable", async () => {
    const admin = adminFor(7005);
    await createSubscription(admin.tenantId, { tier: "starter" });

    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      plans: Array<{ tier: string; action: string; isCurrent: boolean }>;
    };
    const starter = result.plans.find((p) => p.tier === "starter");
    const pro = result.plans.find((p) => p.tier === "pro");
    expect(starter?.isCurrent).toBe(true);
    expect(starter?.action).toBe("current");
    expect(pro?.action).toBe("switch");
  });

  test("start-plan-checkout is rejected with a conflict while a non-terminal subscription exists", async () => {
    const admin = adminFor(7006);
    await createSubscription(admin.tenantId, { tier: "starter" });
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(409);
  });

  test("create-checkout-session mode:subscription is rejected the same way", async () => {
    const admin = adminFor(7007);
    await createSubscription(admin.tenantId, { tier: "starter" });
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock-plan-provider",
        priceId: "price_pro",
        successUrl: "https://app.example.com/s",
        cancelUrl: "https://app.example.com/c",
      },
      admin,
    );
    expect(error.httpStatus).toBe(409);
  });

  test("create-checkout-session mode:payment stays allowed on an active subscription", async () => {
    checkoutCalls.length = 0;
    const admin = adminFor(7008);
    await createSubscription(admin.tenantId, { tier: "starter" });
    const result = (await stack.http.writeOk(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock-plan-provider",
        priceId: "price_topup_credits",
        successUrl: "https://app.example.com/s",
        cancelUrl: "https://app.example.com/c",
        mode: "payment",
      },
      admin,
    )) as { url: string };
    expect(result.url).toBe("https://mock.example/checkout/price_topup_credits");
  });
});

// =============================================================================
// 5. switch-plan — payload passed to createPlanSwitchSession, self-switch and
//    no-subscription both rejected.
// =============================================================================

describe("switch-plan", () => {
  test("pro switch passes providerSubscriptionId, targetPriceId, allowedPriceIds, returnUrl", async () => {
    const admin = adminFor(7009);
    await createSubscription(admin.tenantId, {
      tier: "starter",
      providerSubscriptionId: "sub_switch_7009",
    });

    const result = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    )) as { url: string };

    expect(result.url).toBe("https://mock.example/portal/switch/price_pro");
    expect(switchCalls).toHaveLength(1);
    expect(switchCalls[0]).toEqual({
      providerSubscriptionId: "sub_switch_7009",
      targetPriceId: "price_pro",
      allowedPriceIds: expect.arrayContaining(["price_starter", "price_pro"]),
      returnUrl: "https://app.example.com/billing/success",
    });
  });

  test("switching to the current tier is a conflict", async () => {
    const admin = adminFor(7010);
    await createSubscription(admin.tenantId, { tier: "starter" });
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "starter" },
      admin,
    );
    expect(error.httpStatus).toBe(409);
  });

  test("switching without any subscription is a conflict", async () => {
    const admin = adminFor(7011);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(409);
  });
});

// =============================================================================
// 6. Canceled (terminal) subscription — treated like "no subscription" for
//    checkout purposes, old provider-customer-id carried forward.
// =============================================================================

describe("canceled subscription — fresh checkout, old customer-id reused", () => {
  test("query offers checkout again; start-plan-checkout succeeds and forwards providerCustomerId", async () => {
    const admin = adminFor(7012);
    await createSubscription(admin.tenantId, {
      providerEventId: "evt_7012_create",
      tier: "starter",
      providerCustomerId: "cus_7012_old",
    });
    await createSubscription(admin.tenantId, {
      providerEventId: "evt_7012_cancel",
      status: SubscriptionStatuses.canceled,
      tier: "starter",
      providerCustomerId: "cus_7012_old",
    });

    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      plans: Array<{ tier: string; action: string }>;
    };
    expect(result.plans.find((p) => p.tier === "starter")?.action).toBe("checkout");

    const checkout = (await stack.http.writeOk(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    )) as { url: string };
    expect(checkout.url).toBe("https://mock.example/checkout/price_pro");
    expect(checkoutCalls[0]?.providerCustomerId).toBe("cus_7012_old");
  });
});

// =============================================================================
// 7. isBillingEnabled false — disabled, no live prices fetched, checkout gated.
// =============================================================================

describe("isBillingEnabled: false", () => {
  test("query reports disabled with no prices; non-current plans are unavailable", async () => {
    billingEnabled = false;
    const admin = adminFor(7013);
    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      enabled: boolean;
      plans: Array<{ tier: string; action: string; price: unknown }>;
    };
    expect(result.enabled).toBe(false);
    for (const plan of result.plans) {
      expect(plan.price).toBeNull();
      expect(plan.action).toBe("unavailable");
    }
  });

  test("start-plan-checkout throws feature_disabled", async () => {
    billingEnabled = false;
    const admin = adminFor(7014);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });

  test("switch-plan throws feature_disabled", async () => {
    const admin = adminFor(7017);
    await createSubscription(admin.tenantId, { tier: "starter" });
    billingEnabled = false;
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(403);
  });
});

// =============================================================================
// 7b. switch-plan across providers — the tenant's active subscription lives
//     on a different provider than the catalog resolves.
// =============================================================================

describe("switch-plan — subscription on a different provider than the catalog", () => {
  test("rejected with a conflict instead of calling the wrong provider's plugin", async () => {
    const admin = adminFor(7018);
    await createSubscription(admin.tenantId, {
      tier: "starter",
      providerName: "mock-other-provider",
      providerSubscriptionId: "sub_other_7018",
    });
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.switchPlan,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(409);
    expect(error.i18nKey).toBe("billing-foundation.errors.providerMismatch");
    expect(switchCalls).toHaveLength(0);
  });
});

// =============================================================================
// 8. retrievePrices throws — query still resolves, prices null, checkout blocked.
// =============================================================================

describe("retrievePrices throws", () => {
  test("query stays ok with null prices and unavailable actions", async () => {
    retrievePricesMode = "throw";
    const admin = adminFor(7015);
    const result = (await stack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      admin,
    )) as {
      plans: Array<{ tier: string; action: string; price: unknown }>;
    };
    for (const plan of result.plans) {
      expect(plan.price).toBeNull();
      expect(plan.action).toBe("unavailable");
    }
  });

  test("start-plan-checkout rejects with price_unavailable", async () => {
    retrievePricesMode = "throw";
    const admin = adminFor(7016);
    const error = await stack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      admin,
    );
    expect(error.httpStatus).toBe(422);
  });
});

// =============================================================================
// 9. create-checkout-session hardening — foreign origin, unknown price,
//    a price mapping to a tier outside catalog.plans.
// =============================================================================

describe("create-checkout-session — redirect + price hardening", () => {
  test("a foreign successUrl origin is rejected", async () => {
    const admin = adminFor(7017);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock-plan-provider",
        priceId: "price_pro",
        successUrl: "https://evil.example/success",
        cancelUrl: "https://app.example.com/cancel",
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
  });

  test("an unknown priceId is rejected", async () => {
    const admin = adminFor(7018);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock-plan-provider",
        priceId: "price_does_not_exist",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
  });

  test("a priceId mapping to a tier outside catalog.plans is rejected", async () => {
    const admin = adminFor(7019);
    const error = await stack.http.writeErr(
      "billing-foundation:write:create-checkout-session",
      {
        providerName: "mock-plan-provider",
        priceId: "price_pilot",
        successUrl: "https://app.example.com/success",
        cancelUrl: "https://app.example.com/cancel",
      },
      admin,
    );
    expect(error.httpStatus).toBe(422);
  });
});

// =============================================================================
// 10. Roles — a view-only role sees the catalog read-only, purchase-actions
//     are 403 for it.
// =============================================================================

describe("roles — view-only access without purchase rights", () => {
  let roleStack: TestStack;

  beforeAll(async () => {
    roleStack = await setupTestStack({
      features: [
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createTenantLifecycleFeature(),
        createBillingFoundationFeature({
          baseUrl: "https://app.example.com",
          catalog: catalog({ viewRoles: ["TenantAdmin", "SystemAdmin", "Member"] }),
        }),
        mockPlanProviderFeature,
      ],
    });
    await unsafeCreateEntityTable(roleStack.db, tenantEntity);
    await unsafeCreateEntityTable(roleStack.db, tenantComplianceProfileEntity);
  });

  afterAll(async () => {
    await roleStack.cleanup();
  });

  test("a Member (view-only) sees canPurchase:false and unavailable actions", async () => {
    const member = createTestUser({ id: 7020, tenantId: testTenantId(7020), roles: ["Member"] });
    const result = (await roleStack.http.queryOk(
      "billing-foundation:query:billing-plans",
      {},
      member,
    )) as { canPurchase: boolean; plans: Array<{ action: string }> };
    expect(result.canPurchase).toBe(false);
    for (const plan of result.plans) expect(plan.action).toBe("unavailable");
  });

  test("a Member is rejected with 403 on start-plan-checkout", async () => {
    const member = createTestUser({ id: 7021, tenantId: testTenantId(7021), roles: ["Member"] });
    const error = await roleStack.http.writeErr(
      SubscriptionFoundationHandlers.startPlanCheckout,
      { tier: "pro" },
      member,
    );
    expect(error.httpStatus).toBe(403);
  });
});
