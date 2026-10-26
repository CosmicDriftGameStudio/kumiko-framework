import { describe, expect, test } from "bun:test";
import { describeSubscriptionProviderContract } from "../../billing-foundation/__tests__/subscription-provider-contract.ts";
import {
  createPaddleCancelSubscription,
  createPaddleCheckoutSession,
  createPaddlePortalSession,
} from "../checkout-methods.ts";
import { PADDLE_PROVIDER_NAME, SUBSCRIPTION_PADDLE_FEATURE } from "../constants.ts";
import { createSubscriptionPaddleFeature, paddleEnvSchema } from "../feature.ts";
import { verifyAndParsePaddleWebhook } from "../webhook-events.ts";
import {
  createSendMock,
  envelope,
  makeRuntimes,
  NOW_SECONDS,
  stubCtx,
  subscriptionData,
  TEST_BINDING_KEY,
  TEST_WEBHOOK_SECRET,
  webhookHeaders,
} from "./paddle-test-kit.ts";

const OPTIONS = { priceToTier: { pri_pro: "pro" } };

describe("createSubscriptionPaddleFeature — shape", () => {
  test("has the expected name and hard dependencies", () => {
    const feature = createSubscriptionPaddleFeature(OPTIONS);
    expect(feature.name).toBe(SUBSCRIPTION_PADDLE_FEATURE);
    expect(feature.requires).toEqual(
      expect.arrayContaining(["billing-foundation", "config", "secrets"]),
    );
  });

  test("mounts without any credentials", () => {
    expect(() => createSubscriptionPaddleFeature()).not.toThrow();
  });

  test("registers the plugin as 'paddle' with in-app plan switch and no hosted switch session", () => {
    const feature = createSubscriptionPaddleFeature(OPTIONS);
    const usage = feature.extensionUsages.find((u) => u.entityName === PADDLE_PROVIDER_NAME);
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
    expect(plugin?.["displayName"]).toBe("Paddle");
  });
});

describe("createSubscriptionPaddleFeature — oneOffPriceIds validation", () => {
  test("rejects an empty-string entry", () => {
    expect(() => createSubscriptionPaddleFeature({ oneOffPriceIds: ["pri_a", ""] })).toThrow(
      /must not contain an empty string/,
    );
  });

  test("rejects a duplicate entry", () => {
    expect(() => createSubscriptionPaddleFeature({ oneOffPriceIds: ["pri_a", "pri_a"] })).toThrow(
      /duplicate oneOffPriceIds entry "pri_a"/,
    );
  });
});

describe("paddleEnvSchema", () => {
  test("adds one optional pri_ slot per price next to the bridge fields", () => {
    const schema = paddleEnvSchema({ prices: ["PRO", "TEAM"] });
    expect(Object.keys(schema.shape)).toEqual(
      expect.arrayContaining([
        "PADDLE_API_KEY",
        "PADDLE_WEBHOOK_SECRET",
        "PADDLE_TENANT_BINDING_KEY",
        "PADDLE_CLIENT_TOKEN",
        "PADDLE_PRICE_PRO",
        "PADDLE_PRICE_TEAM",
      ]),
    );
    expect(schema.safeParse({ PADDLE_PRICE_PRO: "pri_123" }).success).toBe(true);
    expect(schema.safeParse({ PADDLE_PRICE_PRO: "pdt_123" }).success).toBe(false);
    expect(schema.safeParse({ PADDLE_CLIENT_TOKEN: "nope" }).success).toBe(false);
    expect(schema.safeParse({ PADDLE_CLIENT_TOKEN: "test_abc" }).success).toBe(true);
    expect(schema.safeParse({}).success).toBe(true);
  });
});

async function buildPaddleContractFixture() {
  const { send } = createSendMock((call) => {
    if (call.url.endsWith("/transactions")) {
      return {
        body: {
          data: {
            id: "txn_1",
            checkout: { url: "https://app.example.com/billing/paddle-checkout?_ptxn=txn_1" },
          },
        },
      };
    }
    if (call.url.includes("/portal-sessions")) {
      return {
        body: { data: { urls: { general: { overview: "https://portal.paddle.test/x" } } } },
      };
    }
    return { body: {} };
  });
  const runtimes = makeRuntimes(send);
  const body = envelope("subscription.created", subscriptionData());
  return {
    plugin: {
      verifyAndParseWebhook: verifyAndParsePaddleWebhook(
        {
          resolveWebhookSecret: async () => TEST_WEBHOOK_SECRET,
          resolveTenantBindingKey: async () => TEST_BINDING_KEY,
        },
        { priceToTier: OPTIONS.priceToTier, nowSeconds: () => NOW_SECONDS },
      ),
      createCheckoutSession: createPaddleCheckoutSession(runtimes.ctx),
      createPortalSession: createPaddlePortalSession(runtimes.ctx),
      cancelSubscription: createPaddleCancelSubscription(runtimes.ctx),
    },
    ctx: stubCtx(),
    checkout: {
      priceId: "pri_pro",
      tenantId: "tenant-paddle",
      successUrl: "https://app.example.com/success",
      cancelUrl: "https://app.example.com/cancel",
    },
    portal: { providerCustomerId: "ctm_contract", returnUrl: "https://example.com/return" },
    cancelSubscriptionId: "sub_contract",
    webhook: {
      rawBody: body,
      headers: webhookHeaders({ timestamp: String(NOW_SECONDS), body }),
      expectedTenantId: "tenant-paddle",
      expectedTier: "pro",
    },
  };
}

describeSubscriptionProviderContract("subscription-paddle", buildPaddleContractFixture, {
  hasPortal: true,
  hasCancel: true,
});
