// Integration test for createSubscriptionTierSync()'s onSyncError option
// (#3027). Forces a sync failure via a dispatchSystemWrite stub that fails
// only the tier-engine handlers (the primary billing-foundation writes run
// for real against the test DB) — proving that "log" (default) still
// answers the webhook successfully, while "fail-webhook" surfaces the sync
// error all the way into the HTTP response.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { buildEntityTable, type EntityTable } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  type EntityDefinition,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { Hono } from "hono";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import type { TierMap } from "../../tier-engine/compose-app";
import { TierEngineHandlers } from "../../tier-engine/constants";
import { tierAssignmentEntity } from "../../tier-engine/entity";
import { createTierEngineFeature } from "../../tier-engine/feature";
import { SubscriptionEventTypes, SubscriptionStatuses } from "../constants";
import { billingFoundationFeature } from "../feature";
import {
  createSubscriptionTierSync,
  SUBSCRIPTION_WEBHOOK_PATH,
  type SystemWriteResult,
} from "../subscription-tier-sync";
import type { SubscriptionEvent, SubscriptionProviderPlugin } from "../types";

type TestTier = "free" | "pro";
const isTierName = (v: string): v is TestTier => v === "free" || v === "pro";
const TEST_TIER_MAP: TierMap<{ readonly maxItems: number }> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: [], caps: { maxItems: 100 } },
};

const mockProviderFeature = defineFeature("test-mock-tier-sync-provider", (r) => {
  r.requires("billing-foundation");
  const plugin: SubscriptionProviderPlugin = {
    verifyAndParseWebhook: async (rawBody) => JSON.parse(rawBody) as SubscriptionEvent,
  };
  r.useExtension("subscriptionProvider", "mock", plugin);
});

// Boundary-cast: SubscriptionTierSyncDeps deliberately erases the entity's
// concrete field types to EntityDefinition (generic factory), which TS
// can't structurally widen to on its own.
const tierAssignmentTable = buildEntityTable(
  "tier-assignment",
  tierAssignmentEntity,
) as unknown as EntityTable<EntityDefinition>;

let stack: TestStack;
let forceTierSyncFailure = false;

async function dispatchSystemWrite(args: {
  readonly handlerQn: string;
  readonly payload: unknown;
  readonly tenantId: TenantId;
}): Promise<SystemWriteResult> {
  if (
    forceTierSyncFailure &&
    (args.handlerQn === TierEngineHandlers.create || args.handlerQn === TierEngineHandlers.update)
  ) {
    return {
      isSuccess: false,
      error: { code: "test_forced_failure", message: "forced tier-sync failure" },
    };
  }
  const systemUser = createTestUser({ id: 1, tenantId: args.tenantId, roles: ["SystemAdmin"] });
  const res = await stack.http.write(args.handlerQn, args.payload, systemUser);
  const body = (await res.json()) as {
    isSuccess: boolean;
    data?: unknown;
    error?: { readonly code?: string; readonly message?: string };
  };
  return body.isSuccess
    ? { isSuccess: true, data: body.data }
    : { isSuccess: false, error: body.error };
}

let logApp: Hono;
let failApp: Hono;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      createTierEngineFeature({ defaultTier: "free", tierMap: TEST_TIER_MAP }),
      mockProviderFeature,
    ],
  });
  await createEventsTable(stack.db);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { tier_assignments: tierAssignmentTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  const sharedDeps = {
    db: stack.db,
    registry: stack.registry,
    dispatchSystemWrite,
    tierAssignmentTable,
    isTierName,
    defaultTier: "free" as const,
  };

  logApp = new Hono();
  createSubscriptionTierSync<TestTier>(sharedDeps).wireSubscriptionWebhookRoute(logApp);

  failApp = new Hono();
  createSubscriptionTierSync<TestTier>({
    ...sharedDeps,
    onSyncError: "fail-webhook",
  }).wireSubscriptionWebhookRoute(failApp);
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

const webhookPath = SUBSCRIPTION_WEBHOOK_PATH.replace(":providerName", "mock");

function buildEvent(tenantId: string, providerEventId: string): SubscriptionEvent {
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
  };
}

describe("createSubscriptionTierSync onSyncError", () => {
  test("default ('log'): a tier-sync failure still returns a successful webhook response", async () => {
    forceTierSyncFailure = true;
    const tenantId = testTenantId(9001);
    const res = await logApp.request(webhookPath, {
      method: "POST",
      body: JSON.stringify(buildEvent(tenantId, "evt_log_1")),
    });
    forceTierSyncFailure = false;

    expect(res.status).toBe(200);
  });

  test("'fail-webhook': a tier-sync failure also fails the webhook response", async () => {
    forceTierSyncFailure = true;
    const tenantId = testTenantId(9002);
    const res = await failApp.request(webhookPath, {
      method: "POST",
      body: JSON.stringify(buildEvent(tenantId, "evt_fail_1")),
    });
    forceTierSyncFailure = false;

    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("subscription_webhook_processing_failed");
  });
});
