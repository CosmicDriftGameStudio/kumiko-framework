// Integration-tests for createSubscriptionWebhookRoute (kumiko-framework
// #3050). No injected dispatchWrite/resolveProvider stubs anymore — the
// route is a real `entry:"signature"` extraRoute mounted through
// setupTestStack, driven with real HTTP against the real dispatcher +
// registry (never createTestDispatcher, per project rule).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import {
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "../constants";
import { billingFoundationFeature } from "../feature";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types";
import { createSubscriptionWebhookRoute } from "../webhook-handler";

const stripeLikePlugin: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
};
const paypalLikePlugin: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
};

// Test-mock-provider whose `verifyAndParseWebhook` is swapped per test via
// `resolvedPlugin` — lets each scenario control verify()'s throw/return
// behavior without touching the wired extraRoute.
const mockProviderFeature = defineFeature("test-mock-webhook-provider", (r) => {
  r.requires("billing-foundation");
  r.useExtension("subscriptionProvider", "stripe", stripeLikePlugin);
  r.useExtension("subscriptionProvider", "paypal", paypalLikePlugin);
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      mockProviderFeature,
    ],
    extraRoutes: [createSubscriptionWebhookRoute()],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

function buildEvent(overrides: Partial<SubscriptionEvent> = {}): SubscriptionEvent {
  return {
    providerEventId: "evt_test_001",
    providerName: "stripe",
    type: SubscriptionEventTypes.created,
    tenantId: testTenantId(5001),
    providerCustomerId: "cus_test",
    providerSubscriptionId: "sub_test",
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    rawPayload: '{"raw":"payload"}',
    ...overrides,
  };
}

async function postWebhook(providerName: string, body: unknown) {
  return stack.app.request(`/api/subscription/webhook/${providerName}`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "stripe-signature": "test_sig" },
  });
}

describe("webhook-handler — happy path", () => {
  test("verifyAndParseWebhook → SubscriptionEvent → process-event write → 200 processed", async () => {
    const res = await postWebhook("stripe", buildEvent({ tenantId: testTenantId(5002) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { processed: boolean; duplicate: boolean };
    expect(body.processed).toBe(true);
    expect(body.duplicate).toBe(false);
  });

  test("plugin returns null (unknown event-type) → 200 ignored", async () => {
    const res = await stack.app.request("/api/subscription/webhook/stripe", {
      method: "POST",
      body: "null",
      headers: { "stripe-signature": "test_sig" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ignored: boolean };
    expect(body.ignored).toBe(true);
  });
});

describe("webhook-handler — error paths", () => {
  test("provider not registered → 404 subscription_provider_not_registered", async () => {
    const res = await postWebhook("ghost-provider", buildEvent());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("subscription_provider_not_registered");
    expect(body.error.message).toMatch(/ghost-provider/);
  });

  test("verify() throws (sig mismatch) → 401 extra_route_signature_invalid", async () => {
    const res = await stack.app.request("/api/subscription/webhook/stripe", {
      method: "POST",
      body: "not valid json — forces JSON.parse to throw inside verify()",
      headers: { "stripe-signature": "test_sig" },
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("extra_route_signature_invalid");
  });

  test("process-event write rejected by schema → 500 subscription_webhook_processing_failed", async () => {
    // status outside the enum trips processEventSchema validation inside
    // process-event.write.ts, so dispatchSystemWrite returns isSuccess:false
    // — a real dispatch failure, not a stubbed one.
    const res = await postWebhook(
      "stripe",
      // @cast-boundary test-only invalid input — deliberately outside the
      // SubscriptionStatus enum to trip processEventSchema validation.
      buildEvent({
        tenantId: testTenantId(5003),
        status: "not-a-real-status" as SubscriptionStatus,
      }),
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as {
      error: { code: string; message: string; details: unknown };
    };
    expect(body.error.code).toBe("subscription_webhook_processing_failed");
  });
});

describe("webhook-handler — multi-provider mounting", () => {
  test("two different path-segments resolve to two different plugins", async () => {
    const stripeRes = await postWebhook(
      "stripe",
      buildEvent({ tenantId: testTenantId(5004), providerEventId: "evt_multi_stripe" }),
    );
    const paypalRes = await postWebhook(
      "paypal",
      buildEvent({
        tenantId: testTenantId(5005),
        providerEventId: "evt_multi_paypal",
        providerName: "paypal",
      }),
    );

    expect(stripeRes.status).toBe(200);
    expect(paypalRes.status).toBe(200);
  });
});
