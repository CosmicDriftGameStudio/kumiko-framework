// feature.ts contract tests for subscription-foundation.

import { describe, expect, test } from "vitest";
import { subscriptionAggregateId, subscriptionEventAggregateId } from "../aggregate-id";
import {
  SUBSCRIPTION_FOUNDATION_FEATURE,
  SUBSCRIPTION_PROVIDER_EXTENSION,
  SubscriptionEventTypes,
  SubscriptionFoundationHandlers,
  SubscriptionStatuses,
} from "../constants";
import { subscriptionFoundationFeature } from "../feature";

describe("subscriptionFoundationFeature — shape", () => {
  test("has the expected name", () => {
    expect(subscriptionFoundationFeature.name).toBe(SUBSCRIPTION_FOUNDATION_FEATURE);
    // Naming-Disziplin pin: NICHT "billing-foundation" — damit
    // marketplace-foundation später ohne Rename dazukommt (siehe
    // docs/plans/architecture/subscription-foundation.md).
    expect(subscriptionFoundationFeature.name).toBe("subscription-foundation");
  });

  test("does NOT require config (Multi-Provider — config liegt in den Plugins)", () => {
    // Drift-Pin: foundation hat KEIN globales `provider`-config-key
    // mehr. Webhook-URL trägt providerName als Pfad-Parameter, jeder
    // gemountete Plugin ist gleichzeitig aktiv. Wenn jemand wieder
    // `r.requires("config")` einbaut, verstößt das gegen die
    // Multi-Provider-Architektur.
    expect(subscriptionFoundationFeature.requires).not.toContain("config");
  });

  test("does NOT require secrets — Provider-Plugins owne ihre eigenen API-Keys", () => {
    expect(subscriptionFoundationFeature.requires).not.toContain("secrets");
  });

  test("foundation has NO config-keys (alle config-keys liegen in den Plugins)", () => {
    // Multi-Provider-Drift-Pin: foundation darf keine config-keys
    // exportieren weil sonst sowas wie "globaler price-to-tier-Map"
    // erzwungen wäre — der existiert NUR pro Plugin (Stripe-priceIds
    // vs PayPal-plan-ids vs Apple-product-ids sind verschieden).
    expect(Object.keys(subscriptionFoundationFeature.configKeys)).toHaveLength(0);
  });
});

describe("subscriptionFoundationFeature — registers extension-point", () => {
  test("declares 'subscriptionProvider' extension-point", () => {
    expect(
      subscriptionFoundationFeature.registrarExtensions[SUBSCRIPTION_PROVIDER_EXTENSION],
    ).toBeDefined();
  });
});

describe("subscriptionFoundationFeature — entities + handlers registered", () => {
  test("subscription + subscription-event entities", () => {
    expect(subscriptionFoundationFeature.entities["subscription"]).toBeDefined();
    expect(subscriptionFoundationFeature.entities["subscription-event"]).toBeDefined();
  });

  test("process-event write-handler registriert mit erwarteter QN", () => {
    expect(subscriptionFoundationFeature.writeHandlers["process-event"]).toBeDefined();
    expect(SubscriptionFoundationHandlers.processEvent).toBe(
      "subscription-foundation:write:process-event",
    );
  });

  test("process-event ist SystemAdmin-only (programmatic-only entry-point)", () => {
    const handler = subscriptionFoundationFeature.writeHandlers["process-event"];
    const access = handler?.access as { roles?: readonly string[] } | undefined;
    expect(access?.roles).toEqual(["SystemAdmin"]);
  });
});

describe("aggregate-id namespaces — drift-pin", () => {
  test("subscriptionAggregateId stable per tenantId", () => {
    expect(subscriptionAggregateId("tenant-1")).toBe("bfe0d98f-293c-5215-af7a-3282629aa5d3");
  });

  test("subscriptionEventAggregateId stable per (tenant, provider, eventId)", () => {
    expect(subscriptionEventAggregateId("tenant-1", "stripe", "evt_test123")).toBe(
      "6230db6b-925b-5309-bcfe-b72c5541056f",
    );
  });

  test("subscription + subscription-event nutzen verschiedene Namespaces (kein Kollision)", () => {
    // Auch wenn jemand eventId="" passes (= leerer string + tenantId|providerName|"")
    // sollen die UUIDs NICHT mit subscriptionAggregateId(tenantId) kollidieren.
    const subId = subscriptionAggregateId("tenant-x");
    const evtId = subscriptionEventAggregateId("tenant-x", "stripe", "");
    expect(subId).not.toBe(evtId);
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
