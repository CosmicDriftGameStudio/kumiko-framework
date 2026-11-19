// Stub subscription provider for e2e and dev seeding. Tier sync (tier engine)
// stays in the app; this only gets a subscription past the checkout ledger.
// It records checkout, portal and plan-switch calls for integration tests.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import type { ProviderPrice, SubscriptionProviderPlugin } from "./types.ts";
import {
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "./web/constants.ts";

export type StubSubscriptionPlan = {
  readonly tier: string;
  readonly priceId: string;
  readonly unitAmount: number;
};

export type StubOneOffPrice = {
  readonly priceId: string;
  readonly unitAmount: number;
  readonly metadata?: ProviderPrice["metadata"];
};

export type StubSeedSubscriptionInput = {
  readonly tier: string;
  readonly status?: SubscriptionStatus;
  readonly currentPeriodEndIso?: string;
  readonly cancelAtIso?: string;
};

// Structurally matches the e2e seeder's `ctx.write`.
export type StubSeedWrite = (handlerQn: string, payload: unknown) => Promise<unknown>;

export type StubSubscriptionProviderOptions = {
  readonly providerName: string;
  readonly featureName?: string;
  readonly displayName?: string;
  readonly currency?: string;
  readonly plans: readonly StubSubscriptionPlan[];
  readonly oneOffPrices?: readonly StubOneOffPrice[];
  readonly overrides?: Partial<SubscriptionProviderPlugin>;
};

type StubCheckoutCall = Parameters<
  NonNullable<SubscriptionProviderPlugin["createCheckoutSession"]>
>[1];
type StubPortalCall = Parameters<NonNullable<SubscriptionProviderPlugin["createPortalSession"]>>[1];
type StubPlanSwitchCall = Parameters<
  NonNullable<SubscriptionProviderPlugin["createPlanSwitchSession"]>
>[1];

export type StubSubscriptionProviderCalls = {
  readonly checkout: readonly StubCheckoutCall[];
  readonly portal: readonly StubPortalCall[];
  readonly planSwitch: readonly StubPlanSwitchCall[];
};

const SEED_PERIOD_HOURS = 24 * 30;

export function createStubSubscriptionProvider(options: StubSubscriptionProviderOptions) {
  const { providerName, plans } = options;
  const oneOffPrices = options.oneOffPrices ?? [];
  const currency = options.currency ?? "eur";
  const featureName = options.featureName ?? `stub-subscription-provider-${providerName}`;
  const disabledTenantIds = new Set<string>();
  const checkoutCalls: StubCheckoutCall[] = [];
  const portalCalls: StubPortalCall[] = [];
  const planSwitchCalls: StubPlanSwitchCall[] = [];

  const priceToTier: Record<string, string> = {};
  for (const plan of plans) priceToTier[plan.priceId] = plan.tier;

  const allPrices: readonly ProviderPrice[] = [
    ...plans.map(
      (plan): ProviderPrice => ({
        priceId: plan.priceId,
        unitAmount: plan.unitAmount,
        currency,
        interval: "month",
        intervalCount: 1,
        active: true,
        metadata: {},
      }),
    ),
    ...oneOffPrices.map(
      (price): ProviderPrice => ({
        priceId: price.priceId,
        unitAmount: price.unitAmount,
        currency,
        interval: null,
        intervalCount: 1,
        active: true,
        metadata: price.metadata ?? {},
      }),
    ),
  ];

  const plugin: SubscriptionProviderPlugin = {
    ...(options.displayName !== undefined && { displayName: options.displayName }),
    verifyAndParseWebhook: async () => null,
    priceToTier,
    ...(oneOffPrices.length > 0 && { oneOffPriceIds: oneOffPrices.map((p) => p.priceId) }),
    isBillingEnabled: async (ctx) => !disabledTenantIds.has(ctx.user.tenantId),
    retrievePrices: async (_ctx, priceIds) => allPrices.filter((p) => priceIds.includes(p.priceId)),
    createCheckoutSession: async (_ctx, o) => {
      checkoutCalls.push(o);
      return { url: o.successUrl, providerCheckoutId: `stub_cs_${crypto.randomUUID()}` };
    },
    createPortalSession: async (_ctx, o) => {
      portalCalls.push(o);
      return { url: o.returnUrl };
    },
    createPlanSwitchSession: async (_ctx, o) => {
      planSwitchCalls.push(o);
      return { url: o.returnUrl };
    },
    // A replaced hook also replaces its recording.
    ...options.overrides,
  };

  const feature = defineFeature(featureName, (r) => {
    r.requires({ features: ["billing-foundation"] });
    r.applyExtension({ name: "subscriptionProvider", entity: providerName, ...plugin });
  });

  function resetCalls(): void {
    checkoutCalls.length = 0;
    portalCalls.length = 0;
    planSwitchCalls.length = 0;
  }

  function setBillingEnabled(tenantId: string, enabled: boolean): void {
    if (enabled) disabledTenantIds.delete(tenantId);
    else disabledTenantIds.add(tenantId);
  }

  async function seedSubscription(
    write: StubSeedWrite,
    tenantId: string,
    input: StubSeedSubscriptionInput,
  ): Promise<void> {
    const { tier } = input;
    const priceId = plans.find((plan) => plan.tier === tier)?.priceId;
    if (priceId === undefined) {
      throw new Error(`stub provider ${providerName}: no plan for tier ${tier}`);
    }
    const providerCheckoutId = `stub_seed_${providerName}_${tenantId}_${tier}`;
    await write(SubscriptionFoundationHandlers.recordCheckoutOpened, {
      providerName,
      providerCheckoutId,
      priceId,
      mode: "subscription",
    });

    const status = input.status ?? SubscriptionStatuses.active;
    const result = await write(SubscriptionFoundationHandlers.processEvent, {
      providerEventId: `stub_evt_${providerName}_${tenantId}_${tier}_${status}`,
      providerName,
      type:
        status === SubscriptionStatuses.canceled
          ? SubscriptionEventTypes.canceled
          : SubscriptionEventTypes.created,
      providerCheckoutId,
      providerCustomerId: `stub_cus_${tenantId}`,
      providerSubscriptionId: `stub_sub_${providerName}_${tenantId}`,
      status,
      tier,
      currentPeriodEndIso:
        input.currentPeriodEndIso ??
        Temporal.Now.instant().add({ hours: SEED_PERIOD_HOURS }).toString(),
      ...(input.cancelAtIso !== undefined && { cancelAtIso: input.cancelAtIso }),
    });
    if (propertyOf(result, "ignored") === true) {
      throw new Error(
        `stub provider ${providerName}: processEvent ignored the seeded subscription for tenant ${tenantId}`,
      );
    }
  }

  const calls: StubSubscriptionProviderCalls = {
    checkout: checkoutCalls,
    portal: portalCalls,
    planSwitch: planSwitchCalls,
  };

  return { feature, plugin, calls, resetCalls, setBillingEnabled, seedSubscription };
}
