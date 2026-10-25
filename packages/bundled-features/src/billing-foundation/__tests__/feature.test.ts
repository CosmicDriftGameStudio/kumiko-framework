// feature.ts contract tests for subscription-foundation.

import { describe, expect, test } from "bun:test";
import { paymentAggregateId, paymentRowId, subscriptionAggregateId } from "../aggregate-id.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import type { BillingPlanCatalog } from "../types.ts";
import {
  BILLING_FOUNDATION_FEATURE,
  BILLING_PLANS_SCREEN_ID,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../web/constants.ts";

function catalog(overrides: Partial<BillingPlanCatalog> = {}): BillingPlanCatalog {
  return {
    plans: ["basic", "pro"],
    tierLabelKey: (tier) => `plan.${tier}.label`,
    benefits: () => [],
    resolveCurrentTier: async () => "basic",
    viewRoles: ["TenantAdmin", "SystemAdmin"],
    successPath: "/billing/success",
    cancelPath: "/billing/cancel",
    ...overrides,
  };
}

describe("billingFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(createBillingFoundationFeature().name).toBe(BILLING_FOUNDATION_FEATURE);
    // Naming constraint: not "billing-foundation" so that
    // marketplace-foundation can be added later without a rename (see
    // docs/plans/architecture/subscription-foundation.md).
    expect(createBillingFoundationFeature().name).toBe("billing-foundation");
  });

  test("does NOT require config (Multi-Provider — config liegt in den Plugins)", () => {
    // Drift pin: the foundation has no global `provider` config key. The
    // webhook URL carries providerName as a path parameter and every mounted
    // plugin is active at once. Adding `r.requires({ features: ["config"] })`
    // back would break the multi-provider architecture.
    expect(createBillingFoundationFeature().requires).not.toContain("config");
  });

  test("does NOT require secrets — Provider-Plugins owne ihre eigenen API-Keys", () => {
    expect(createBillingFoundationFeature().requires).not.toContain("secrets");
  });

  test("foundation has NO config-keys (alle config-keys liegen in den Plugins)", () => {
    // Multi-provider constraint: the foundation must not export config keys,
    // because that would force a global price-to-tier map. The map exists only
    // per plugin because Stripe price IDs, PayPal plan IDs, and Apple product IDs
    // differ.
    expect(Object.keys(createBillingFoundationFeature().configKeys)).toHaveLength(0);
  });
});

describe("billingFoundationFeature — registers extension-point", () => {
  test("declares 'subscriptionProvider' extension-point", () => {
    expect(
      createBillingFoundationFeature().registrarExtensions[SUBSCRIPTION_PROVIDER_EXTENSION],
    ).toBeDefined();
  });
});

describe("billingFoundationFeature — events + projection + handlers registered", () => {
  test("5 domain-events registriert (created/updated/canceled/invoice-paid/invoice-payment-failed)", () => {
    const events = createBillingFoundationFeature().events;
    expect(events["subscription-created"]).toBeDefined();
    expect(events["subscription-updated"]).toBeDefined();
    expect(events["subscription-canceled"]).toBeDefined();
    expect(events["invoice-paid"]).toBeDefined();
    expect(events["invoice-payment-failed"]).toBeDefined();
  });

  test("subscription-projection registered with 5 apply keys", () => {
    const proj = createBillingFoundationFeature().projections["subscription"];
    expect(proj).toBeDefined();
    const applyKeys = Object.keys(proj?.apply ?? {});
    expect(applyKeys).toHaveLength(5);
  });

  test("process-event write-handler registered with expected QN", () => {
    expect(createBillingFoundationFeature().writeHandlers["process-event"]).toBeDefined();
    expect(SubscriptionFoundationHandlers.processEvent).toBe(
      "billing-foundation:write:process-event",
    );
  });

  test("process-event is SystemAdmin-only (programmatic-only entry-point)", () => {
    const handler = createBillingFoundationFeature().writeHandlers["process-event"];
    const access = handler?.access as { roles?: readonly string[] } | undefined;
    expect(access?.roles).toEqual(["SystemAdmin"]);
  });
});

describe("aggregate-id namespace — drift-pin", () => {
  test("subscriptionAggregateId stable per tenantId", () => {
    expect(subscriptionAggregateId("tenant-1")).toBe("bfe0d98f-293c-5215-af7a-3282629aa5d3");
  });

  test("paymentAggregateId stable per tenantId", () => {
    expect(paymentAggregateId("tenant-1")).toBe("ea425f43-38a8-53c5-98b2-084affd718c1");
  });

  test("paymentRowId stable per (tenantId, providerName, providerEventId)", () => {
    expect(paymentRowId("tenant-1", "mock", "evt_1")).toBe("51117d31-4394-5f4e-a123-b30bc37f30b8");
  });
});

describe("normalized constants — provider-agnostic event-types + statuses", () => {
  test("EventTypes whitelist — was die Foundation kennt", () => {
    expect(Object.values(SubscriptionEventTypes)).toEqual([
      "subscription.created",
      "subscription.updated",
      "subscription.canceled",
      "invoice.paid",
      "invoice.payment-failed",
    ]);
  });

  test("Statuses normalized across Stripe + Mollie", () => {
    expect(Object.values(SubscriptionStatuses)).toEqual([
      "active",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
    ]);
  });
});

describe("createBillingFoundationFeature — factory validation", () => {
  test("mounts with no options at all", () => {
    expect(() => createBillingFoundationFeature()).not.toThrow();
  });

  test("mounts with only baseUrl, no catalog", () => {
    expect(() => createBillingFoundationFeature({ baseUrl: "https://example.com" })).not.toThrow();
  });

  test("throws when baseUrl is not a parseable absolute URL", () => {
    expect(() => createBillingFoundationFeature({ baseUrl: "not-a-url" })).toThrow(
      /not a parseable absolute URL/,
    );
  });

  test("throws when baseUrl uses a non-http(s) scheme", () => {
    expect(() => createBillingFoundationFeature({ baseUrl: "ftp://example.com" })).toThrow(
      /must use http or https/,
    );
  });

  test("accepts https and http baseUrls", () => {
    expect(() => createBillingFoundationFeature({ baseUrl: "https://example.com" })).not.toThrow();
    expect(() =>
      createBillingFoundationFeature({ baseUrl: "http://localhost:3000" }),
    ).not.toThrow();
  });

  test("throws when catalog is set without baseUrl", () => {
    expect(() => createBillingFoundationFeature({ catalog: catalog() })).toThrow(
      /catalog requires baseUrl/,
    );
  });

  test("mounts when catalog and baseUrl are both set", () => {
    expect(() =>
      createBillingFoundationFeature({ baseUrl: "https://example.com", catalog: catalog() }),
    ).not.toThrow();
  });

  test("throws when catalog.plans is empty", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ plans: [] }),
      }),
    ).toThrow(/catalog.plans must not be empty/);
  });

  test("throws when catalog.plans has a duplicate tier", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ plans: ["pro", "pro"] }),
      }),
    ).toThrow(/duplicate tier "pro"/);
  });

  test("throws when successPath doesn't start with /", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ successPath: "billing/success" }),
      }),
    ).toThrow(/successPath "billing\/success" must start with "\/"/);
  });

  test("throws when cancelPath is protocol-relative (//)", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ cancelPath: "//evil.example.com" }),
      }),
    ).toThrow(/cancelPath/);
  });

  test("throws when returnPath is set and invalid", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ returnPath: "not-root-relative" }),
      }),
    ).toThrow(/returnPath/);
  });

  test("accepts a valid returnPath", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ returnPath: "/billing/return" }),
      }),
    ).not.toThrow();
  });

  test("throws when viewRoles is empty", () => {
    expect(() =>
      createBillingFoundationFeature({
        baseUrl: "https://example.com",
        catalog: catalog({ viewRoles: [] }),
      }),
    ).toThrow(/viewRoles must not be empty/);
  });
});

describe("createBillingFoundationFeature — catalog.contact validation", () => {
  const contact = {
    labelKey: "plan.enterprise.label",
    benefits: [{ labelKey: "plan.enterprise.benefit" }],
    actionLabelKey: "plan.enterprise.action",
    href: "https://example.com/contact",
  };

  function mountWith(overrides: Partial<typeof contact>): void {
    createBillingFoundationFeature({
      baseUrl: "https://example.com",
      catalog: catalog({ contact: { ...contact, ...overrides } }),
    });
  }

  test.each(["https://example.com/contact", "mailto:sales@example.com"])(
    "mounts with %s",
    (href) => {
      expect(() => mountWith({ href })).not.toThrow();
    },
  );

  test.each([
    "javascript:alert(1)",
    "http://example.com/contact",
    "data:text/html,x",
    " https://example.com",
    "/contact",
    "mailto:",
  ])("rejects href %p", (href) => {
    expect(() => mountWith({ href })).toThrow(
      `catalog.contact.href "${href}" must be an absolute https: or mailto: URL.`,
    );
  });

  test("rejects an empty labelKey", () => {
    expect(() => mountWith({ labelKey: "  " })).toThrow(
      /catalog\.contact\.labelKey must not be empty/,
    );
  });

  test("rejects an empty actionLabelKey", () => {
    expect(() => mountWith({ actionLabelKey: "" })).toThrow(
      /catalog\.contact\.actionLabelKey must not be empty/,
    );
  });
});

describe("billingFoundationFeature — dormant billing-plans screen", () => {
  test("not registered without a catalog", () => {
    const feature = createBillingFoundationFeature({ baseUrl: "https://example.com" });
    expect(feature.screens[BILLING_PLANS_SCREEN_ID]).toBeUndefined();
  });

  test("not registered with no options at all", () => {
    expect(createBillingFoundationFeature().screens[BILLING_PLANS_SCREEN_ID]).toBeUndefined();
  });

  test("registered once a catalog is configured", () => {
    const feature = createBillingFoundationFeature({
      baseUrl: "https://example.com",
      catalog: catalog(),
    });
    expect(feature.screens[BILLING_PLANS_SCREEN_ID]).toBeDefined();
  });
});
