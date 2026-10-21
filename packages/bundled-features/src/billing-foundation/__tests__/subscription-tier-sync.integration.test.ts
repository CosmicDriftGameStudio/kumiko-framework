// Integration test for createSubscriptionTierSync(). No stubbed dispatchSystemWrite
// anymore — the sync reads and writes through the real dispatcher via the
// extraRoute's dispatchSystemQuery/dispatchSystemWrite, exercised with real HTTP.
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
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
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
import type { TierMap } from "../../tier-engine/compose-app.ts";
import { tierAssignmentEntity } from "../../tier-engine/entity.ts";
import { createTierEngineFeature } from "../../tier-engine/feature.ts";
import {
  TierAssignmentSources,
  TierEngineHandlers,
  TierEngineQueries,
} from "../../tier-engine/web/constants.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { createSubscriptionTierSync } from "../subscription-tier-sync.ts";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types.ts";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../web/constants.ts";

type TestTier = "free" | "pro" | "enterprise";
const isTierName = (v: string): v is TestTier => v === "free" || v === "pro" || v === "enterprise";
const TEST_TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: [], caps: { maxItems: 100 } },
  enterprise: { features: [], caps: { maxItems: 1000 } },
};

function mockProviderFeature() {
  return defineFeature("test-mock-tier-sync-provider", (r) => {
    r.requires({ features: ["billing-foundation"] });
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
  createBillingFoundationFeature(),
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
        providerSubscriptionId: "sub_evt_create_2",
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

  async function listAssignmentRows(tenantId: string, userId: number) {
    const admin = createTestUser({
      id: userId,
      tenantId: testTenantId(userId),
      roles: ["SystemAdmin"],
    });
    const listed = (await stack.http.queryOk(TierEngineQueries.list, {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    return listed.rows.filter((row) => row["tenantId"] === tenantId);
  }

  test("manual grant survives subscription created and canceled webhooks", async () => {
    const tenantId = testTenantId(9103);
    const admin = createTestUser({ id: 9103, tenantId, roles: ["SystemAdmin"] });
    await stack.http.writeOk(TierEngineHandlers.setTenantTier, { tenantId, tier: "pro" }, admin);

    const created = await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_create_3", {
        status: SubscriptionStatuses.active,
        tier: "free",
      }),
    );
    expect(created.status).toBe(200);
    let rows = await listAssignmentRows(tenantId, 9103);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tier"]).toBe("pro");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.manual);

    const canceled = await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_cancel_3", {
        type: SubscriptionEventTypes.canceled,
        status: SubscriptionStatuses.canceled,
        tier: "free",
        providerSubscriptionId: "sub_evt_create_3",
      }),
    );
    expect(canceled.status).toBe(200);
    rows = await listAssignmentRows(tenantId, 9103);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tier"]).toBe("pro");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.manual);
  });

  test("handing a manual grant back to billing lets the next sync overwrite it", async () => {
    const tenantId = testTenantId(9105);
    const admin = createTestUser({ id: 9105, tenantId, roles: ["SystemAdmin"] });
    await stack.http.writeOk(TierEngineHandlers.setTenantTier, { tenantId, tier: "pro" }, admin);

    await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_create_5", {
        status: SubscriptionStatuses.active,
        tier: "enterprise",
      }),
    );
    let rows = await listAssignmentRows(tenantId, 9105);
    expect(rows[0]?.["tier"]).toBe("pro");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.manual);

    await stack.http.writeOk(
      TierEngineHandlers.setTenantTier,
      { tenantId, tier: "pro", source: TierAssignmentSources.billing },
      admin,
    );
    await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_update_5", {
        type: SubscriptionEventTypes.updated,
        status: SubscriptionStatuses.active,
        tier: "enterprise",
        providerSubscriptionId: "sub_evt_create_5",
      }),
    );

    rows = await listAssignmentRows(tenantId, 9105);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tier"]).toBe("enterprise");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.billing);
  });

  test("without a manual grant the tier follows the subscription and is marked as billing", async () => {
    const tenantId = testTenantId(9104);
    await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_create_4", { status: SubscriptionStatuses.active, tier: "pro" }),
    );
    let rows = await listAssignmentRows(tenantId, 9104);
    expect(rows[0]?.["tier"]).toBe("pro");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.billing);

    await postWebhook(
      stack,
      webhookPath,
      buildEvent(tenantId, "evt_cancel_4", {
        type: SubscriptionEventTypes.canceled,
        status: SubscriptionStatuses.canceled,
        tier: "pro",
        providerSubscriptionId: "sub_evt_create_4",
      }),
    );
    rows = await listAssignmentRows(tenantId, 9104);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.["tier"]).toBe("free");
    expect(rows[0]?.["source"]).toBe(TierAssignmentSources.billing);
  });
});

// =============================================================================
// 'fail-webhook' retry — the option exists so a provider retry with the same
// providerEventId re-runs the sync after the primary write already committed.
// The real transient fault: tier-engine is mounted but its table is gone for
// the first delivery and restored before the retry.
// =============================================================================

describe("createSubscriptionTierSync 'fail-webhook' — provider retry", () => {
  let stack: TestStack;
  let webhookPath: string;

  beforeAll(async () => {
    const sync = createSubscriptionTierSync<TestTier>({
      isTierName,
      defaultTier: "free",
      onSyncError: "fail-webhook",
    });
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

  test("500 on the failed sync, then the same providerEventId retries as duplicate and fixes the tier", async () => {
    const tenantId = testTenantId(9201);
    const event = buildEvent(tenantId, "evt_retry_1", {
      status: SubscriptionStatuses.active,
      tier: "pro",
    });

    await asRawClient(stack.db).unsafe("DROP TABLE read_tier_assignments");
    const first = await postWebhook(stack, webhookPath, event);
    expect(first.status).toBe(500);

    await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
    const retry = await postWebhook(stack, webhookPath, event);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { duplicate: boolean }).duplicate).toBe(true);

    const admin = createTestUser({ id: 9201, tenantId, roles: ["SystemAdmin"] });
    const listed = (await stack.http.queryOk(TierEngineQueries.list, {}, admin)) as {
      rows: Array<Record<string, unknown>>;
    };
    expect(listed.rows).toHaveLength(1);
    expect(listed.rows[0]?.["tier"]).toBe("pro");
  });
});
