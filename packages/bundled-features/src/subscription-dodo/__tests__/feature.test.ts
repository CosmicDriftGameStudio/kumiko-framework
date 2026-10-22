import { describe, expect, test } from "bun:test";
import { describeSubscriptionProviderContract } from "../../billing-foundation/__tests__/subscription-provider-contract.ts";
import { DODO_PROVIDER_NAME, SUBSCRIPTION_DODO_FEATURE } from "../constants.ts";
import { createSubscriptionDodoFeature } from "../feature.ts";
import {
  createDodoCancelSubscription,
  createDodoCheckoutSession,
  createDodoPortalSession,
} from "../plugin-methods.ts";
import { verifyAndParseDodoWebhook } from "../verify-webhook.ts";
import {
  createSendMock,
  envelope,
  makeRuntimes,
  NOW_SECONDS,
  stubCtx,
  subscriptionData,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./dodo-test-kit.ts";

const OPTIONS = { priceToTier: { pdt_pro: "pro" } };

describe("createSubscriptionDodoFeature — shape", () => {
  test("has the expected name and hard dependencies", () => {
    const feature = createSubscriptionDodoFeature(OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_DODO_FEATURE);
    expect(feature.requires).toEqual(
      expect.arrayContaining(["billing-foundation", "config", "secrets"]),
    );
  });

  test("mounts without any credentials", () => {
    expect(() => createSubscriptionDodoFeature()).not.toThrow();
  });

  test("registers the plugin as 'dodo' with in-app plan switch and no hosted switch session", () => {
    const feature = createSubscriptionDodoFeature(OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === DODO_PROVIDER_NAME);
    expect(usage?.extensionName).toBe("subscriptionProvider");
    const plugin = usage?.options as Record<string, unknown> | undefined;
    for (const method of [
      "verifyAndParseWebhook",
      "createCheckoutSession",
      "createPortalSession",
      "cancelSubscription",
      "resumeSubscription",
      "retrievePrices",
      "retrieveSubscription",
      "previewPlanSwitch",
      "applyPlanSwitch",
      "isBillingEnabled",
    ]) {
      expect(typeof plugin?.[method]).toBe("function");
    }
    expect(plugin?.["createPlanSwitchSession"]).toBeUndefined();
    expect(plugin?.["displayName"]).toBe("Dodo Payments");
  });
});

describe("createSubscriptionDodoFeature — oneOffPriceIds validation", () => {
  test("rejects an empty-string entry", () => {
    expect(() => createSubscriptionDodoFeature({ oneOffPriceIds: ["pdt_a", ""] })).toThrow(
      /must not contain an empty string/,
    );
  });

  test("rejects a duplicate entry", () => {
    expect(() => createSubscriptionDodoFeature({ oneOffPriceIds: ["pdt_a", "pdt_a"] })).toThrow(
      /duplicate oneOffPriceIds entry "pdt_a"/,
    );
  });
});

async function buildDodoContractFixture() {
  const { send } = createSendMock((call) => {
    if (call.url.endsWith("/checkouts")) {
      return { body: { session_id: "cks_1", checkout_url: "https://checkout.dodo/cks_1" } };
    }
    if (call.url.includes("/customer-portal/session")) {
      return { body: { link: "https://portal.dodo/x" } };
    }
    return { body: {} };
  });
  const runtimes = makeRuntimes(send);
  const body = envelope("subscription.active", subscriptionData());
  return {
    plugin: {
      verifyAndParseWebhook: verifyAndParseDodoWebhook(
        { resolveWebhookSecret: async () => TEST_WEBHOOK_SECRET },
        { priceToTier: OPTIONS.priceToTier, nowSeconds: () => NOW_SECONDS },
      ),
      createCheckoutSession: createDodoCheckoutSession(runtimes.ctx),
      createPortalSession: createDodoPortalSession(runtimes.ctx),
      cancelSubscription: createDodoCancelSubscription(runtimes.ctx),
    },
    ctx: stubCtx(),
    checkout: {
      priceId: "pdt_pro",
      tenantId: "tenant-dodo",
      successUrl: "https://example.com/success",
      cancelUrl: "https://example.com/cancel",
    },
    portal: { providerCustomerId: "cus_contract", returnUrl: "https://example.com/return" },
    cancelSubscriptionId: "sub_contract",
    webhook: {
      rawBody: body,
      headers: webhookHeaders({ id: "msg_contract", timestamp: String(NOW_SECONDS), body }),
      expectedTenantId: "tenant-dodo",
      expectedTier: "pro",
    },
  };
}

describeSubscriptionProviderContract("subscription-dodo", buildDodoContractFixture, {
  hasPortal: true,
  hasCancel: true,
});
