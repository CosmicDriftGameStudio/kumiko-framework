// Integration-tests for createSubscriptionWebhookRoute. No injected
// dispatchWrite/resolveProvider stubs anymore — the route is a real
// `entry:"signature"` extraRoute mounted through setupTestStack, driven with
// real HTTP against the real dispatcher + registry (never
// createTestDispatcher, per project rule).

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { subscriptionsProjectionTable } from "../projection.ts";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types.ts";
import {
  SubscriptionEventTypes,
  type SubscriptionStatus,
  SubscriptionStatuses,
} from "../web/constants.ts";
import { createSubscriptionWebhookRoute } from "../webhook-handler.ts";
import {
  ledgerWriteAs,
  openSubscriptionCheckout,
  priceIdForTier,
} from "./ledgered-subscription.ts";

const PRICE_TO_TIER: Readonly<Record<string, string>> = { price_pro: "pro" };

const stripeLikePlugin: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
  priceToTier: PRICE_TO_TIER,
};
const paypalLikePlugin: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
  priceToTier: PRICE_TO_TIER,
};

// Asks for redelivery of every ignored event whose id starts with "redeliver".
const redeliveringPlugin: SubscriptionProviderPlugin = {
  verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent | null,
  priceToTier: PRICE_TO_TIER,
  shouldRedeliverIgnoredEvent: async ({ event }) => event.providerEventId.startsWith("redeliver"),
};

const AFTER_DISPATCH_PATH = "/api/test/after-dispatch/:providerName";
const afterDispatchCalls: string[] = [];

// Test-mock-provider whose `verifyAndParseWebhook` is swapped per test via
// `resolvedPlugin` — lets each scenario control verify()'s throw/return
// behavior without touching the wired extraRoute.
const mockProviderFeature = defineFeature("test-mock-webhook-provider", (r) => {
  r.requires({ features: ["billing-foundation"] });
  r.useExtension("subscriptionProvider", "stripe", stripeLikePlugin);
  r.useExtension("subscriptionProvider", "paypal", paypalLikePlugin);
  r.useExtension("subscriptionProvider", "redelivering", redeliveringPlugin);
});

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature(),
      mockProviderFeature,
    ],
    extraRoutes: [
      createSubscriptionWebhookRoute(),
      createSubscriptionWebhookRoute({
        path: AFTER_DISPATCH_PATH,
        afterDispatch: async (dispatched, _tenantId, _deps, event) => {
          afterDispatchCalls.push(event.providerEventId);
          return dispatched;
        },
      }),
    ],
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
    ...overrides,
  };
}

async function withLedgeredCheckout(event: SubscriptionEvent): Promise<SubscriptionEvent> {
  const providerCheckoutId = await openSubscriptionCheckout(ledgerWriteAs(stack, event.tenantId), {
    providerName: event.providerName,
    providerSubscriptionId: event.providerSubscriptionId,
    priceId: priceIdForTier(PRICE_TO_TIER, event.tier),
  });
  return { ...event, providerCheckoutId };
}

async function postWebhook(providerName: string, body: unknown, path?: string) {
  const url = (path ?? "/api/subscription/webhook/:providerName").replace(
    ":providerName",
    providerName,
  );
  return stack.app.request(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "stripe-signature": "test_sig" },
  });
}

describe("webhook-handler — happy path", () => {
  test("verifyAndParseWebhook → SubscriptionEvent → process-event write → 200 processed", async () => {
    const res = await postWebhook(
      "stripe",
      await withLedgeredCheckout(buildEvent({ tenantId: testTenantId(5002) })),
    );
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
      await withLedgeredCheckout(
        buildEvent({
          tenantId: testTenantId(5003),
          status: "not-a-real-status" as SubscriptionStatus,
        }),
      ),
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
      await withLedgeredCheckout(
        buildEvent({ tenantId: testTenantId(5004), providerEventId: "evt_multi_stripe" }),
      ),
    );
    const paypalRes = await postWebhook(
      "paypal",
      await withLedgeredCheckout(
        buildEvent({
          tenantId: testTenantId(5005),
          providerEventId: "evt_multi_paypal",
          providerName: "paypal",
        }),
      ),
    );

    expect(stripeRes.status).toBe(200);
    expect(paypalRes.status).toBe(200);
  });
});

describe("webhook-handler — late events of a superseded subscription", () => {
  const tenantId = testTenantId(5100);

  async function currentRow() {
    const rows = await selectMany(stack.db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantId),
    });
    return rows[0] as { status: string; providerSubscriptionId: string } | undefined;
  }

  async function post(overrides: Partial<SubscriptionEvent>) {
    const event = await withLedgeredCheckout(buildEvent({ tenantId, ...overrides }));
    const res = await postWebhook("stripe", event);
    expect(res.status).toBe(200);
    return (await res.json()) as { processed: boolean; duplicate: boolean; stale?: boolean };
  }

  test("a late canceled event of the old subscription leaves the new subscription's row active", async () => {
    await post({
      providerEventId: "evt_old_created",
      type: SubscriptionEventTypes.created,
      providerSubscriptionId: "sub_old",
      status: SubscriptionStatuses.incomplete,
    });
    await post({
      providerEventId: "evt_old_cancel",
      type: SubscriptionEventTypes.canceled,
      providerSubscriptionId: "sub_old",
      status: SubscriptionStatuses.canceled,
    });
    await post({
      providerEventId: "evt_new_created",
      type: SubscriptionEventTypes.created,
      providerSubscriptionId: "sub_new",
      status: SubscriptionStatuses.active,
    });

    const late = await post({
      providerEventId: "evt_old_late_cancel",
      type: SubscriptionEventTypes.updated,
      providerSubscriptionId: "sub_old",
      status: SubscriptionStatuses.canceled,
    });

    expect(late.stale).toBe(true);
    expect(await currentRow()).toMatchObject({
      status: SubscriptionStatuses.active,
      providerSubscriptionId: "sub_new",
    });
  });

  test("events of the tracked subscription keep applying", async () => {
    const update = await post({
      providerEventId: "evt_new_update",
      type: SubscriptionEventTypes.updated,
      providerSubscriptionId: "sub_new",
      status: SubscriptionStatuses.pastDue,
    });

    expect(update.stale).toBeUndefined();
    expect(await currentRow()).toMatchObject({ status: SubscriptionStatuses.pastDue });
  });

  test("a first-delivered created event of another subscription does not replace a live row", async () => {
    const late = await post({
      providerEventId: "evt_third_created",
      type: SubscriptionEventTypes.created,
      providerSubscriptionId: "sub_third",
      status: SubscriptionStatuses.incomplete,
    });

    expect(late.stale).toBe(true);
    expect(await currentRow()).toMatchObject({
      providerSubscriptionId: "sub_new",
      status: SubscriptionStatuses.pastDue,
    });
  });

  test("once the tracked subscription is canceled, an event of another subscription applies", async () => {
    await post({
      providerEventId: "evt_new_cancel",
      type: SubscriptionEventTypes.canceled,
      providerSubscriptionId: "sub_new",
      status: SubscriptionStatuses.canceled,
    });
    const next = await post({
      providerEventId: "evt_fourth_update",
      type: SubscriptionEventTypes.updated,
      providerSubscriptionId: "sub_fourth",
      status: SubscriptionStatuses.active,
    });

    expect(next.stale).toBeUndefined();
    expect(await currentRow()).toMatchObject({ providerSubscriptionId: "sub_fourth" });
  });
});

describe("webhook-handler — checkout ledger admission", () => {
  const tenantId = testTenantId(5200);

  async function rowCount() {
    const rows = await selectMany(stack.db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantId),
    });
    return rows.length;
  }

  test("a created event for a checkout the server never opened answers 200 ignored and stores nothing", async () => {
    const res = await postWebhook(
      "stripe",
      buildEvent({ tenantId, providerEventId: "evt_unledgered", providerCheckoutId: "cs_forged" }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
    expect(await rowCount()).toBe(0);
  });

  test("afterDispatch runs for a processed event and is skipped for an ignored one", async () => {
    afterDispatchCalls.length = 0;
    const ignored = await postWebhook(
      "stripe",
      buildEvent({
        tenantId,
        providerEventId: "evt_after_ignored",
        providerCheckoutId: "cs_forged",
      }),
      AFTER_DISPATCH_PATH,
    );
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toMatchObject({ ignored: true });
    expect(afterDispatchCalls).toEqual([]);

    const processed = await postWebhook(
      "stripe",
      await withLedgeredCheckout(buildEvent({ tenantId, providerEventId: "evt_after_processed" })),
      AFTER_DISPATCH_PATH,
    );
    expect(processed.status).toBe(200);
    expect(await processed.json()).toMatchObject({ processed: true });
    expect(afterDispatchCalls).toEqual(["evt_after_processed"]);
  });
});

describe("webhook-handler — delivery order and redelivery", () => {
  const tenantId = testTenantId(5300);

  test("an updated event before its created answers a retryable 503, and is applied once redelivered after created", async () => {
    const updated = buildEvent({
      tenantId,
      providerEventId: "evt_order_updated",
      type: SubscriptionEventTypes.updated,
      providerSubscriptionId: "sub_order",
      status: SubscriptionStatuses.pastDue,
    });
    const early = await postWebhook("stripe", updated);
    expect(early.status).toBe(503);
    expect(early.headers.get("retry-after")).not.toBeNull();
    expect(await early.json()).toMatchObject({
      error: { code: "subscription_event_redeliver", reason: "subscription_not_yet_created" },
    });

    const created = await postWebhook(
      "stripe",
      await withLedgeredCheckout(
        buildEvent({
          tenantId,
          providerEventId: "evt_order_created",
          providerSubscriptionId: "sub_order",
        }),
      ),
    );
    expect(created.status).toBe(200);

    const redelivered = await postWebhook("stripe", updated);
    expect(redelivered.status).toBe(200);
    expect(await redelivered.json()).toMatchObject({ processed: true });
    const rows = await selectMany(stack.db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(tenantId),
    });
    expect(rows[0]).toMatchObject({ status: SubscriptionStatuses.pastDue });
  });

  test("an updated event of another subscription than the held one stays a 200 ignore", async () => {
    const res = await postWebhook(
      "stripe",
      buildEvent({
        tenantId,
        providerEventId: "evt_order_foreign",
        type: SubscriptionEventTypes.updated,
        providerSubscriptionId: "sub_someone_else",
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ignored: true });
  });

  test("a provider plugin can ask for redelivery of an event that is not in the ledger", async () => {
    const asked = await postWebhook(
      "redelivering",
      buildEvent({
        tenantId: testTenantId(5301),
        providerName: "redelivering",
        providerEventId: "redeliver_1",
        providerCheckoutId: "cs_not_yet_ledgered",
      }),
    );
    expect(asked.status).toBe(503);

    const declined = await postWebhook(
      "redelivering",
      buildEvent({
        tenantId: testTenantId(5301),
        providerName: "redelivering",
        providerEventId: "other_1",
        providerCheckoutId: "cs_not_yet_ledgered",
      }),
    );
    expect(declined.status).toBe(200);
    expect(await declined.json()).toMatchObject({ ignored: true });
  });
});
