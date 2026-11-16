// Stub provider from billing-foundation/testing, driven through the real stack:
// plans query, per-tenant billing toggle and ledger-admitted seeding.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
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
import { subscriptionAggregateId } from "../aggregate-id.ts";
import { createBillingFoundationFeature } from "../feature.ts";
import { subscriptionsProjectionTable } from "../projection.ts";
import { createStubSubscriptionProvider } from "../testing.ts";
import { SubscriptionStatuses } from "../web/constants.ts";

const stub = createStubSubscriptionProvider({
  providerName: "stub-test",
  plans: [
    { tier: "starter", priceId: "price_starter", unitAmount: 900 },
    { tier: "pro", priceId: "price_pro", unitAmount: 1900 },
  ],
});

async function resolveCurrentTier(db: TenantDb, tenantId: string): Promise<string> {
  const rows = await db.selectMany(
    subscriptionsProjectionTable,
    { id: subscriptionAggregateId(tenantId) },
    { limit: 1 },
  );
  const row = rows[0];
  if (!row) return "free";
  const status = row["status"];
  const tier = row["tier"];
  return (status === SubscriptionStatuses.active || status === SubscriptionStatuses.trialing) &&
    typeof tier === "string"
    ? tier
    : "free";
}

type PlansResult = {
  enabled: boolean;
  currentTier: { tier: string };
  plans: Array<{ tier: string; action: string; price: { unitAmount: number } | null }>;
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature({
        baseUrl: "https://app.example.com",
        catalog: {
          plans: ["starter", "pro"],
          tierLabelKey: (tier) => `plan.${tier}.label`,
          benefits: (tier) => [{ labelKey: `plan.${tier}.benefit.core` }],
          resolveCurrentTier,
          viewRoles: ["TenantAdmin", "SystemAdmin"],
          successPath: "/billing/success",
          cancelPath: "/billing/cancel",
          providerName: "stub-test",
        },
      }),
      stub.feature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

function adminFor(tenantNumber: number) {
  return createTestUser({
    id: tenantNumber,
    tenantId: testTenantId(tenantNumber),
    roles: ["TenantAdmin", "SystemAdmin"],
  });
}

async function queryPlans(admin: ReturnType<typeof adminFor>): Promise<PlansResult> {
  return (await stack.http.queryOk(
    "billing-foundation:query:billing-plans",
    {},
    admin,
  )) as PlansResult;
}

describe("stub subscription provider", () => {
  test("billing-plans lists the stub plans with checkout actions and their prices", async () => {
    const result = await queryPlans(adminFor(8101));
    expect(result.enabled).toBe(true);
    const starter = result.plans.find((p) => p.tier === "starter");
    const pro = result.plans.find((p) => p.tier === "pro");
    expect(starter?.action).toBe("checkout");
    expect(starter?.price?.unitAmount).toBe(900);
    expect(pro?.action).toBe("checkout");
    expect(pro?.price?.unitAmount).toBe(1900);
  });

  test("setBillingEnabled(false) disables billing for that tenant only", async () => {
    const disabled = adminFor(8102);
    const other = adminFor(8103);
    stub.setBillingEnabled(disabled.tenantId, false);
    try {
      expect((await queryPlans(disabled)).enabled).toBe(false);
      expect((await queryPlans(other)).enabled).toBe(true);
    } finally {
      stub.setBillingEnabled(disabled.tenantId, true);
    }
  });

  test("seedSubscription creates an active subscription the ledger admits", async () => {
    const admin = adminFor(8104);
    await stub.seedSubscription(
      (qn, payload) => stack.http.writeOk(qn, payload, admin),
      admin.tenantId,
      { tier: "pro" },
    );

    const rows = await selectMany(stack.db, subscriptionsProjectionTable, {
      id: subscriptionAggregateId(admin.tenantId),
    });
    expect(rows[0]?.["status"]).toBe(SubscriptionStatuses.active);
    expect(rows[0]?.["tier"]).toBe("pro");
    expect((await queryPlans(admin)).currentTier.tier).toBe("pro");
  });

  test("seedSubscription rejects a tier without a stub plan", async () => {
    const admin = adminFor(8105);
    await expect(
      stub.seedSubscription((qn, payload) => stack.http.writeOk(qn, payload, admin), admin.tenantId, {
        tier: "enterprise",
      }),
    ).rejects.toThrow("no plan for tier enterprise");
  });
});
