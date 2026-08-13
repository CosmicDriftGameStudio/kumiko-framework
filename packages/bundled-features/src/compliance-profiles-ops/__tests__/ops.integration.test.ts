import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import {
  createComplianceProfilesFeature,
  tenantComplianceProfileEntity,
} from "../../compliance-profiles";
import { seedComplianceProfile } from "../../compliance-profiles/seeding";
import { createConfigFeature } from "../../config/feature";
import { TenantHandlers } from "../../tenant/constants";
import { createTenantFeature } from "../../tenant/feature";
import { tenantEntity } from "../../tenant/schema/tenant";
import { complianceProfilesOpsFeature } from "../index";

const TENANTS_MISSING_PROFILE = "compliance-profiles-ops:query:tenants-missing-profile";

let stack: TestStack;

const opsAdmin = createTestUser({ id: 900, tenantId: testTenantId(900), roles: ["SystemAdmin"] });
const tenantWithProfile = testTenantId(901);
const tenantWithoutProfile = testTenantId(902);
const disabledTenantWithoutProfile = testTenantId(903);

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      complianceProfilesOpsFeature,
    ],
  });
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);

  for (const [id, key] of [
    [tenantWithProfile, "with-profile"],
    [tenantWithoutProfile, "without-profile"],
    [disabledTenantWithoutProfile, "disabled-without-profile"],
  ] as const) {
    await stack.http.writeOk(TenantHandlers.create, { id, key, name: key }, opsAdmin);
  }
  await stack.http.writeOk(TenantHandlers.disable, { id: disabledTenantWithoutProfile }, opsAdmin);
  await seedComplianceProfile(stack.db, { tenantId: tenantWithProfile, profileKey: "eu-dsgvo" });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("tenants-missing-profile (#2089)", () => {
  test("SystemAdmin sees only the enabled tenant without a profile", async () => {
    const result = await stack.http.queryOk<{
      tenants: readonly { id: string; name: string }[];
    }>(TENANTS_MISSING_PROFILE, {}, opsAdmin);

    const ids = result.tenants.map((t) => t.id);
    expect(ids).toContain(tenantWithoutProfile);
    expect(ids).not.toContain(tenantWithProfile);
    expect(ids).not.toContain(disabledTenantWithoutProfile);
  });

  test("TenantAdmin gets 403", async () => {
    const tenantAdmin = createTestUser({
      id: 904,
      tenantId: tenantWithoutProfile,
      roles: ["TenantAdmin"],
    });
    expect((await stack.http.query(TENANTS_MISSING_PROFILE, {}, tenantAdmin)).status).toBe(403);
  });
});
