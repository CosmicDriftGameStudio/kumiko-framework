// feature.ts contract tests for subscription-foundation.

import { describe, expect, test } from "bun:test";
import { paymentAggregateId, paymentRowId, subscriptionAggregateId } from "../aggregate-id";
import {
  BILLING_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants";
import { billingFoundationFeature } from "../feature";

describe("billingFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(billingFoundationFeature.name).toBe(BILLING_FOUNDATION_FEATURE);
    // Naming-Disziplin pin: NICHT "billing-foundation" — damit
    // marketplace-foundation später ohne Rename dazukommt (siehe
    // docs/plans/architecture/subscription-foundation.md).
    expect(billingFoundationFeature.name).toBe("billing-foundation");
  });

  test("does NOT require config (Multi-Provider — config liegt in den Plugins)", () => {
    // Drift-Pin: foundation hat KEIN globales `provider`-config-key
    // mehr. Webhook-URL trägt providerName als Pfad-Parameter, jeder
    // gemountete Plugin ist gleichzeitig aktiv. Wenn jemand wieder
    // `r.requires("config")` einbaut, verstößt das gegen die
    // Multi-Provider-Architektur.
    expect(billingFoundationFeature.requires).not.toContain("config");
  });

  test("does NOT require secrets — Provider-Plugins owne ihre eigenen API-Keys", () => {
    expect(billingFoundationFeature.requires).not.toContain("secrets");
  });

  test("foundation has NO config-keys (alle config-keys liegen in den Plugins)", () => {
    // Multi-Provider-Drift-Pin: foundation darf keine config-keys
    // exportieren weil sonst sowas wie "globaler price-to-tier-Map"
    // erzwungen wäre — der existiert NUR pro Plugin (Stripe-priceIds
    // vs PayPal-plan-ids vs Apple-product-ids sind verschieden).
    expect(Object.keys(billingFoundationFeature.configKeys)).toHaveLength(0);
  });
});

describe("billingFoundationFeature — registers extension-point", () => {
  test("declares 'subscriptionProvider' extension-point", () => {
    expect(
      billingFoundationFeature.registrarExtensions[SUBSCRIPTION_PROVIDER_EXTENSION],
    ).toBeDefined();
  });
});

describe("billingFoundationFeature — events + projection + handlers registered", () => {
  test("5 domain-events registriert (created/updated/canceled/invoice-paid/invoice-payment-failed)", () => {
    const events = billingFoundationFeature.events;
    expect(events["subscription-created"]).toBeDefined();
    expect(events["subscription-updated"]).toBeDefined();
    expect(events["subscription-canceled"]).toBeDefined();
    expect(events["invoice-paid"]).toBeDefined();
    expect(events["invoice-payment-failed"]).toBeDefined();
  });

  test("subscription-projection registriert mit 5 apply-keys", () => {
    const proj = billingFoundationFeature.projections["subscription"];
    expect(proj).toBeDefined();
    const applyKeys = Object.keys(proj?.apply ?? {});
    expect(applyKeys).toHaveLength(5);
  });

  test("process-event write-handler registriert mit erwarteter QN", () => {
    expect(billingFoundationFeature.writeHandlers["process-event"]).toBeDefined();
    expect(SubscriptionFoundationHandlers.processEvent).toBe(
      "billing-foundation:write:process-event",
    );
  });

  test("process-event ist SystemAdmin-only (programmatic-only entry-point)", () => {
    const handler = billingFoundationFeature.writeHandlers["process-event"];
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

  test("Statuses normalized über Stripe + Mollie", () => {
    expect(Object.values(SubscriptionStatuses)).toEqual([
      "active",
      "trialing",
      "past_due",
      "canceled",
      "incomplete",
    ]);
  });
});
