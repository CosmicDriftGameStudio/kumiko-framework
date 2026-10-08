import { describe, expect, test } from "bun:test";
import type { HandlerContext } from "@cosmicdrift/kumiko-framework/engine";
import { UnconfiguredError, UnprocessableError } from "@cosmicdrift/kumiko-framework/errors";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  assertCheckoutAllowed,
  assertRedirectOrigins,
  isBillingEnabled,
  isNonEmptyStringArray,
  isOwnProviderCustomer,
  joinBaseUrl,
} from "../checkout-core.js";
import type { SubscriptionView } from "../get-subscription-for-tenant.js";
import type { SubscriptionProviderPlugin } from "../types.js";

function subscriptionView(overrides: Partial<SubscriptionView> = {}): SubscriptionView {
  return {
    tier: "pro",
    status: "canceled",
    providerName: "mock",
    providerCustomerId: "cus_own",
    providerSubscriptionId: "sub_own",
    currentPeriodEnd: Temporal.Instant.from("2024-02-01T00:00:00Z"),
    cancelAt: null,
    lastChangedAt: Temporal.Instant.from("2024-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("assertRedirectOrigins", () => {
  test("throws UnconfiguredError when baseUrl is undefined, regardless of urls", () => {
    expect(() => assertRedirectOrigins(["https://example.com/success"], undefined)).toThrow(
      UnconfiguredError,
    );
  });

  test("throws UnconfiguredError when baseUrl is not a parseable absolute URL", () => {
    expect(() => assertRedirectOrigins(["https://example.com/success"], "not-a-url")).toThrow(
      UnconfiguredError,
    );
  });

  test("passes when every url shares baseUrl's origin", () => {
    expect(() =>
      assertRedirectOrigins(
        ["https://example.com/success", "https://example.com/cancel"],
        "https://example.com",
      ),
    ).not.toThrow();
  });

  test("passes when baseUrl carries a path prefix — only the origin is compared", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com/success"], "https://example.com/tenant-x"),
    ).not.toThrow();
  });

  test("throws UnprocessableError('redirect_origin_not_allowed') for a different origin", () => {
    expect(() =>
      assertRedirectOrigins(["https://attacker.example/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a lookalike host that merely starts with baseUrl's host", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com.evil.com/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a different scheme on an otherwise-matching host", () => {
    expect(() =>
      assertRedirectOrigins(["http://example.com/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a different port", () => {
    expect(() =>
      assertRedirectOrigins(["https://example.com:8443/success"], "https://example.com"),
    ).toThrow(UnprocessableError);
  });

  test("throws UnprocessableError for a url that isn't a parseable absolute URL", () => {
    expect(() => assertRedirectOrigins(["/relative/path"], "https://example.com")).toThrow(
      UnprocessableError,
    );
  });

  test("empty urls list never throws, even with baseUrl set", () => {
    expect(() => assertRedirectOrigins([], "https://example.com")).not.toThrow();
  });
});

describe("joinBaseUrl", () => {
  test("concatenates baseUrl and path as-is when baseUrl has no trailing slash", () => {
    expect(joinBaseUrl("https://app.example.com", "/billing/success")).toBe(
      "https://app.example.com/billing/success",
    );
  });

  test("strips a trailing slash on baseUrl so the result never becomes protocol-relative", () => {
    expect(joinBaseUrl("https://app.example.com/", "/billing/success")).toBe(
      "https://app.example.com/billing/success",
    );
  });

  test("preserves a path-prefix baseUrl (tenant subdirectory)", () => {
    expect(joinBaseUrl("https://app.example.com/tenant-x", "/billing/success")).toBe(
      "https://app.example.com/tenant-x/billing/success",
    );
  });

  test("preserves a path-prefix baseUrl with a trailing slash, without doubling the slash", () => {
    expect(joinBaseUrl("https://app.example.com/tenant-x/", "/billing/success")).toBe(
      "https://app.example.com/tenant-x/billing/success",
    );
  });
});

describe("isNonEmptyStringArray", () => {
  test("true for a non-empty array", () => {
    expect(isNonEmptyStringArray(["pro"])).toBe(true);
  });

  test("false for an empty array", () => {
    expect(isNonEmptyStringArray([])).toBe(false);
  });
});

describe("isOwnProviderCustomer", () => {
  test("false when the tenant has no subscription at all", () => {
    expect(isOwnProviderCustomer(null, "mock", "cus_own")).toBe(false);
  });

  test("false for a subscription at a different provider", () => {
    expect(
      isOwnProviderCustomer(subscriptionView({ providerName: "stripe" }), "mock", "cus_own"),
    ).toBe(false);
  });

  test("false for a different customer id at the same provider", () => {
    expect(isOwnProviderCustomer(subscriptionView(), "mock", "cus_other_tenant")).toBe(false);
  });

  test("true for the tenant's own customer id at the same provider, even canceled", () => {
    expect(isOwnProviderCustomer(subscriptionView(), "mock", "cus_own")).toBe(true);
  });
});

function fakeCtxWithProvider(
  entries: ReadonlyArray<{ readonly entityName: string; readonly options: unknown }>,
): HandlerContext {
  return {
    registry: {
      getExtensionUsages: () => entries,
    },
  } as unknown as HandlerContext; // @cast-boundary test-fixture — only registry is exercised
}

describe("isBillingEnabled", () => {
  test("false when no provider with that name is registered", async () => {
    const ctx = fakeCtxWithProvider([]);
    expect(await isBillingEnabled(ctx, "stripe")).toBe(false);
  });

  test("false when the registered plugin's own isBillingEnabled reports false", async () => {
    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: async () => null,
      isBillingEnabled: async () => false,
    };
    const ctx = fakeCtxWithProvider([{ entityName: "stripe", options: plugin }]);
    expect(await isBillingEnabled(ctx, "stripe")).toBe(false);
  });

  test("true when the registered plugin has no isBillingEnabled (defaults to enabled)", async () => {
    const plugin: SubscriptionProviderPlugin = { verifyAndParseWebhook: async () => null };
    const ctx = fakeCtxWithProvider([{ entityName: "stripe", options: plugin }]);
    expect(await isBillingEnabled(ctx, "stripe")).toBe(true);
  });
});

describe("assertCheckoutAllowed — caller-supplied gate results", () => {
  const now = () => Temporal.Instant.from("2024-03-01T00:00:00Z");
  const input = {
    providerName: "stripe",
    priceId: "price_pro",
    successUrl: "https://app.test/ok",
    cancelUrl: "https://app.test/cancel",
  };

  function setup(billingEnabled: boolean) {
    const calls = { billingEnabled: 0 };
    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: async () => null,
      priceToTier: { price_pro: "pro" },
      createCheckoutSession: async () => ({ url: "https://pay.test/s" }),
      isBillingEnabled: async () => {
        calls.billingEnabled += 1;
        return billingEnabled;
      },
    };
    // No `db`: a repeated subscription lookup would throw, proving it is skipped.
    const ctx = fakeCtxWithProvider([{ entityName: "stripe", options: plugin }]);
    return { calls, ctx };
  }

  test("billingEnabledChecked + checkedSubscription skip the repeated gates", async () => {
    const { calls, ctx } = setup(true);
    await assertCheckoutAllowed(
      ctx,
      {
        baseUrl: "https://app.test",
        now,
        billingEnabledChecked: true,
        checkedSubscription: null,
      },
      input,
    );
    expect(calls.billingEnabled).toBe(0);
  });

  test("without billingEnabledChecked a disabled provider is rejected here", async () => {
    const { calls, ctx } = setup(false);
    await expect(
      assertCheckoutAllowed(
        ctx,
        { baseUrl: "https://app.test", now, checkedSubscription: null },
        input,
      ),
    ).rejects.toMatchObject({ name: "FeatureDisabledError" });
    expect(calls.billingEnabled).toBe(1);
  });
});
