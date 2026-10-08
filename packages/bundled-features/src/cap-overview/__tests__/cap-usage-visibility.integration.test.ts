import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests } from "@cosmicdrift/kumiko-framework/testing";
import { billingFoundationFeature } from "../../billing-foundation/index.js";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles/index.js";
import { createConfigFeature } from "../../config/index.js";
import { createTenantFeature } from "../../tenant/feature.js";
import { tenantEntity } from "../../tenant/schema/tenant.js";
import { seedTenant } from "../../tenant/seeding.js";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle/index.js";
import {
  TierEngineHandlers,
  tierAssignmentEntity,
  tierEngineFeature,
} from "../../tier-engine/index.js";
import { CapOverviewQueries } from "../constants.js";
import { type CreateCapOverviewOptions, createCapOverviewFeature } from "../feature.js";
import type { CapSpec } from "../types.js";

const TENANT = testTenantId(9301);

const widgetCap: CapSpec = {
  id: "widgets",
  label: "test.cap.widgets",
  limit: () => 10,
  usage: async () => 3,
};

async function startStack(options: Pick<CreateCapOverviewOptions, "usageVisibleTo">) {
  const stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      billingFoundationFeature,
      tierEngineFeature,
      createCapOverviewFeature({ caps: [widgetCap], ...options }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tierAssignmentEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  configurePiiSubjectKms(new InMemoryKmsAdapter());
  await seedTenant(stack.db, { id: TENANT, key: `cap-visibility-${TENANT}`, name: "Visibility" });
  const owner = createTestUser({
    id: 93011,
    tenantId: TENANT,
    roles: ["TenantAdmin", "SystemAdmin"],
  });
  await stack.http.writeOk(TierEngineHandlers.create, { tier: "pro" }, owner);
  return stack;
}

const member = createTestUser({ id: 93012, tenantId: TENANT, roles: ["User"] });
const tenantAdmin = createTestUser({ id: 93013, tenantId: TENANT, roles: ["TenantAdmin"] });

describe("caps:usage visibility defaults to admins", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await startStack({});
  });
  afterAll(async () => {
    await stack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  test("a regular User gets 403", async () => {
    const res = await stack.http.query(CapOverviewQueries.capsUsage, {}, member);
    expect(res.status).toBe(403);
  });

  test("a TenantAdmin reads own-tenant usage", async () => {
    const res = await stack.http.query(CapOverviewQueries.capsUsage, {}, tenantAdmin);
    expect(res.status).toBe(200);
  });
});

describe("caps:usage visibility with usageVisibleTo", () => {
  let stack: TestStack;
  beforeAll(async () => {
    stack = await startStack({ usageVisibleTo: ["User", "TenantAdmin"] });
  });
  afterAll(async () => {
    await stack.cleanup();
    resetPiiSubjectKmsForTests();
  });

  test("a regular User reads own-tenant usage", async () => {
    const res = await stack.http.query(CapOverviewQueries.capsUsage, {}, member);
    expect(res.status).toBe(200);
  });

  test("a role outside the list still gets 403", async () => {
    const editor = createTestUser({ id: 93014, tenantId: TENANT, roles: ["Editor"] });
    const res = await stack.http.query(CapOverviewQueries.capsUsage, {}, editor);
    expect(res.status).toBe(403);
  });
});
