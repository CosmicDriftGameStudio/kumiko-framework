// Integration test for createSubscriptionTierSync() (kumiko-framework
// #3050 rewrite). No stubbed dispatchSystemWrite anymore — the sync reads
// and writes through the real dispatcher via the extraRoute's
// dispatchSystemQuery/dispatchSystemWrite, exercised with real HTTP.
//
// `createWebhookRoute()` has a fixed path (SUBSCRIPTION_WEBHOOK_PATH), so
// the two onSyncError modes ("log" vs "fail-webhook") each need their own
// stack — you can't mount the same path twice on one Hono app.
//
// The forced sync failure is a REAL one: a stack that never mounts
// tier-engine, so `TierEngineQueries.list` resolves to no handler and
// dispatchSystemQuery throws — exactly what a consumer forgetting to mount
// tier-engine would hit in production.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
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
import type { TierMap } from "../../tier-engine/compose-app";
import { TierEngineQueries } from "../../tier-engine/constants";
import { tierAssignmentEntity } from "../../tier-engine/entity";
import { createTierEngineFeature } from "../../tier-engine/feature";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../constants";
import { billingFoundationFeature } from "../feature";
import { createSubscriptionTierSync } from "../subscription-tier-sync";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types";

type TestTier = "free" | "pro";
const isTierName = (v: string): v is TestTier => v === "free" || v === "pro";
const TEST_TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: [], caps: { maxItems: 100 } },
};

function mockProviderFeature() {
  return defineFeature("test-mock-tier-sync-provider", (r) => {
    r.requires("billing-foundation");
    const plugin: SubscriptionProviderPlugin = {
      verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent,
    };
    r.useExtension("subscriptionProvider", "mock", plugin);
  });
}

const sharedBaseFeatures = () => [
  createConfigFeature(),
  createTenantFeature(),
  createComplianceProfilesFeature(),
  createTenantLifecycleFeature(),
  billingFoundationFeature,
  mockProviderFeature(),
];

async function bootStack(
  features: ReturnType<typeof sharedBaseFeatures>,
  extraRoutes: NonNullable<Parameters<typeof setupTestStack>[0]["extraRoutes"]>,
): Promise<TestStack> {
  const stack = await setupTestStack({ features, extraRoutes });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  return stack;
}

function buildEvent(
  tenantId: string,
  providerEventId: string,
  overrides: Partial<SubscriptionEvent> = {},
): SubscriptionEvent {
  return {
    providerEventId,
    providerName: "mock",
    type: SubscriptionEventTypes.created,
    tenantId,
    providerCustomerId: `cus_${providerEventId}`,
    providerSubscriptionId: `sub_${providerEventId}`,
    status: SubscriptionStatuses.active,
    tier: "pro",
    currentPeriodEnd: "2026-06-01T00:00:00Z",
    rawPayload: "{}",
    ...overrides,
  };
}

async function postWebhook(stack: TestStack, path: string, event: SubscriptionEvent) {
  return stack.app.request(path.replace(":providerName", "mock"), {
    method: "POST",
    body: JSON.stringify(event),
  });
}

// =============================================================================
// onSyncError — tier-engine deliberately NOT mounted, so the sync's
// dispatchSystemQuery(TierEngineQueries.list) throws a real NotFoundError.
// =============================================================================

describe("createSubscriptionTierSync onSyncError", () => {
  let logStack: TestStack;
  let failStack: TestStack;
  let logPath: string;
  let failPath: string;

  beforeAll(async () => {
    const logSync = createSubscriptionTierSync<TestTier>({ isTierName, defaultTier: "free" });
    const logRoute = logSync.createWebhookRoute();
    logStack = await bootStack(sharedBaseFeatures(), [logRoute]);
    logPath = logRoute.path;

    const failSync = createSubscriptionTierSync<TestTier>({
      isTierName,
      defaultTier: "free",
      onSyncError: "fail-webhook",
    });
    const failRoute = failSync.createWebhookRoute();
    failStack = await bootStack(sharedBaseFeatures(), [failRoute]);
    failPath = failRoute.path;
  });

  afterAll(async () => {
    await logStack.cleanup();
    await failStack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  test("default ('log'): a tier-sync failure still returns a successful webhook response", async () => {
    const tenantId = testTenantId(9001);
    const res = await postWebhook(logStack, logPath, buildEvent(tenantId, "evt_log_1"));
    expect(res.status).toBe(200);
  });

  test("'fail-webhook': a tier-sync failure also fails the webhook response", async () => {
    const tenantId = testTenantId(9002);
    const res = await postWebhook(failStack, failPath, buildEvent(tenantId, "evt_fail_1"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_webhook_processing_failed");
  });
});

// =============================================================================
// Happy path — tier-engine mounted, tier-sync effect visible through
// TierEngineQueries.list.
// =============================================================================

describe("createSubscriptionTierSync — tier-sync effect", () => {
  let stack: TestStack;
  let webhookPath: string;

  beforeAll(async () => {
    const sync = createSubscriptionTierSync<TestTier>({ isTierName, defaultTier: "free" });
    const route = sync.createWebhookRoute();
    webhookPath = route.path;
    stack = await bootStack(
      [
        ...sharedBaseFeatures(),
        createTierEngineFeature({ defaultTier: "free", tierMap: TEST_TIER_MAP }),
      ],
      [route],
    );
  });

  afterAll(async () => {
    await stack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  test("active subscription → tier-assignment created with the subscription's tier", async () => {
    const tenantId = testTenantId(9101);
    const res = await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_create_1", { status: SubscriptionStatuses.active, tier: "pro" }),
    );
    expect(res.status).toBe(200);

    const admin = createTestUser({ id: 9101, tenantId, roles: ["SystemAdmin"] });
    const listed = (await stack.http.queryOk(TierEngineQueries.list, {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.["tier"]).toBe("pro");
  });

  test("subsequent canceled event → tier-assignment updated to the default tier", async () => {
    const tenantId = testTenantId(9102);
    await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_create_2", { status: SubscriptionStatuses.active, tier: "pro" }),
    );

    const res = await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_cancel_2", {
        type: SubscriptionEventTypes.canceled,
        status: SubscriptionStatuses.canceled,
        tier: "pro",
      }),
    );
    expect(res.status).toBe(200);

    const admin = createTestUser({ id: 9102, tenantId, roles: ["SystemAdmin"] });
    const listed = (await stack.http.queryOk(TierEngineQueries.list, {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.["tier"]).toBe("free");
  });
});
