import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { access, createSystemConfig, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { billingFoundationFeature } from "../../billing-foundation";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { ConfigHandlers } from "../../config/constants";
import { createConfigAccessorFactory, createConfigFeature } from "../../config/feature";
import { createConfigResolver } from "../../config/resolver";
import { configValuesTable } from "../../config/table";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { seedTenant } from "../../tenant/seeding";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { TierEngineHandlers, tierAssignmentEntity, tierEngineFeature } from "../../tier-engine";
import { CapOverviewQueries } from "../constants";
import { createCapOverviewFeature } from "../feature";
import type { CapSpec } from "../types";

const BUDGET_KEY = "cap-budget-probe:config:public-budget";
const STATIC_PRO_LIMIT = 50;
const TENANT_A = testTenantId(9201);

const budgetFeature = defineFeature("cap-budget-probe", (r) => {
  r.requires("config");
  r.config({
    keys: {
      publicBudget: createSystemConfig("number", {
        default: 10,
        write: access.systemAdmin,
        read: access.systemAdmin,
      }),
    },
  });
});

// The "public" tier's limit comes from a SystemAdmin-editable config key; every
// other tier keeps a static number, so both call shapes (sync, async) are covered.
const budgetCap: CapSpec = {
  id: "public-budget",
  label: "test.cap.publicBudget",
  limit: async (tier, { config }) => {
    if (tier !== "public") return STATIC_PRO_LIMIT;
    const value = await config?.(BUDGET_KEY);
    return typeof value === "number" ? value : null;
  },
  usage: async () => 4,
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      budgetFeature,
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      tierEngineFeature,
      createCapOverviewFeature({ caps: [budgetCap] }),
    ],
    extraContext: ({ registry }) => {
      const resolver = createConfigResolver();
      return {
        configResolver: resolver,
        _configAccessorFactory: createConfigAccessorFactory(registry, resolver),
      };
    },
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable });
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  await seedTenant(stack.db, { id: TENANT_A, key: `cap-budget-${TENANT_A}`, name: "Public" });
  const ownerA = createTestUser({
    id: 92011,
    tenantId: TENANT_A,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "public" }, ownerA);
});

afterAll(async () => {
  await stack.cleanup();
});

type CapsUsageResult = { readonly rows: readonly { id: string; limit: number | null }[] };
type TenantCapsListResult = {
  readonly rows: readonly (Record<string, unknown> & { tenantId: string })[];
};

async function limitsSeenByBothQueries(): Promise<{
  readonly capsUsage: number | null | undefined;
  readonly tenantCapsList: unknown;
}> {
  const member = createTestUser({ id: 92012, tenantId: TENANT_A, roles: ["User"] });
  const usage = await stack.http.queryOk<CapsUsageResult>(CapOverviewQueries.capsUsage, {}, member);
  const list = await stack.http.queryOk<TenantCapsListResult>(
    CapOverviewQueries.tenantCapsList,
    { limit: 50 },
    TestUsers.systemAdmin,
  );
  const listRow = list.rows.find((row) => row.tenantId === TENANT_A);
  return {
    capsUsage: usage.rows.find((row) => row.id === budgetCap.id)?.limit,
    tenantCapsList: listRow === undefined ? undefined : Object.values(listRow),
  };
}

describe("CapSpec.limit resolved from runtime config", () => {
  test("caps:usage and tenant-caps:list follow a changed config value", async () => {
    const before = await limitsSeenByBothQueries();
    expect(before.capsUsage).toBe(10);
    expect(before.tenantCapsList).toContainEqual({ used: 4, limit: 10, fraction: 0.4 });

    await stack.http.writeOk(
      ConfigHandlers.set,
      { key: BUDGET_KEY, value: 200, scope: "system" },
      TestUsers.systemAdmin,
    );

    const after = await limitsSeenByBothQueries();
    expect(after.capsUsage).toBe(200);
    expect(after.tenantCapsList).toContainEqual({ used: 4, limit: 200, fraction: 0.02 });
  });
});
