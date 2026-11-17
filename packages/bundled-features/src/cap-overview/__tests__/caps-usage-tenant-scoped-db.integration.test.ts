import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { AccessDeniedError } from "@cosmicdrift/kumiko-framework/errors";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createBillingFoundationFeature } from "../../billing-foundation/index.ts";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/index.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantEntity } from "../../tenant/schema/tenant.ts";
import { seedTenant } from "../../tenant/seeding.ts";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.ts";
import {
  createTierEngineFeature,
  TierEngineHandlers,
  tierAssignmentEntity,
  tierAssignmentTable,
} from "../../tier-engine/index.ts";
import { createCapOverviewFeature } from "../feature.ts";
import type { CapSpec } from "../types.ts";
import { CapOverviewQueries } from "../web/constants.ts";

const TENANT_A = testTenantId(9201);
const TENANT_B = testTenantId(9202);

// Deliberately no tenantId filter: only the db handed to the callback may keep other tenants' rows out.
const unfilteredAssignmentCountCap: CapSpec = {
  id: "unfiltered-assignment-count",
  label: "test.cap.unfilteredAssignmentCount",
  limit: async (_tier, { db }) => 10 + (await db.count(tierAssignmentTable)),
  usage: (db) => db.count(tierAssignmentTable),
};

const unsafeRawProbeCap: CapSpec = {
  id: "unsafe-raw-probe",
  label: "test.cap.unsafeRawProbe",
  limit: () => 10,
  usage: async (db) => {
    try {
      db.unsafeRawAllTenants();
      return 1;
    } catch (error) {
      return error instanceof AccessDeniedError ? 0 : 2;
    }
  },
};

type UsageResult = {
  rows: readonly { id: string; used: number | null; limit: number | null }[];
};

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      createBillingFoundationFeature(),
      createTierEngineFeature(),
      createCapOverviewFeature({ caps: [unfilteredAssignmentCountCap, unsafeRawProbeCap] }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());

  for (const [tenantId, ownerId] of [
    [TENANT_A, 92011],
    [TENANT_B, 92021],
  ] as const) {
    await seedTenant(stack.db, {
      id: tenantId,
      key: `cap-overview-scoped-${tenantId}`,
      name: `Tenant ${tenantId}`,
    });
    const owner = createTestUser({
      id: ownerId,
      tenantId,
      roles: ["TenantAdmin", "SystemAdmin"],
    });
    await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, owner);
  }
});

afterAll(async () => {
  await stack.cleanup();
  resetPiiSubjectKmsForTests();
});

describe("caps:usage hands cap callbacks a tenant-scoped db", () => {
  test("a TenantAdmin's caps:usage callback without a tenantId filter counts only its own tenant's rows", async () => {
    const admin = createTestUser({ id: 92012, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const result = await stack.http.queryOk<UsageResult>(CapOverviewQueries.capsUsage, {}, admin);
    const row = result.rows.find((r) => r.id === unfilteredAssignmentCountCap.id);
    expect(row?.used).toBe(1);
    expect(row?.limit).toBe(11);
  });

  test("the SystemAdmin override hands the callback only the target tenant's rows", async () => {
    const systemAdmin = createTestUser({ id: 92013, tenantId: TENANT_A, roles: ["SystemAdmin"] });
    const result = await stack.http.queryOk<UsageResult>(
      CapOverviewQueries.capsUsage,
      { tenantId: TENANT_B },
      systemAdmin,
    );
    const row = result.rows.find((r) => r.id === unfilteredAssignmentCountCap.id);
    expect(row?.used).toBe(1);
    expect(row?.limit).toBe(11);
  });

  test("a callback's db.unsafeRaw() is rejected inside caps:usage", async () => {
    const admin = createTestUser({ id: 92012, tenantId: TENANT_A, roles: ["TenantAdmin"] });
    const result = await stack.http.queryOk<UsageResult>(CapOverviewQueries.capsUsage, {}, admin);
    const row = result.rows.find((r) => r.id === unsafeRawProbeCap.id);
    expect(row?.used).toBe(0);
  });
});
