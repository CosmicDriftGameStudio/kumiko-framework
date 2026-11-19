import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { configurePiiSubjectKms, InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, TestUsers, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-testing/helpers";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { createConfigFeature } from "../../config/index.ts";
import { configValuesTable } from "../../config/table.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { tenantMembershipsTable } from "../../tenant/membership-table.ts";
import { tenantEntity, tenantTable } from "../../tenant/schema/tenant.ts";
import { TenantHandlers } from "../../tenant/web/constants.ts";
import { createUserFeature } from "../../user/feature.ts";
import { userEntity, userTable } from "../../user/schema/user.ts";
import { createComplianceProfilesFeature } from "../feature.ts";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection.ts";

const FOR_TENANT = "compliance-profiles:query:for-tenant";
const SET_PROFILE = "compliance-profiles:write:set-profile";

const creator: SessionUser = { ...TestUsers.systemAdmin, tenantId: testTenantId(7) };

type ForTenant = { profile: { key: string }; warning?: string };

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature({ defaultProfile: "swiss-dsg" }),
    ],
  });
  await unsafeCreateEntityTable(stack.db, userEntity);
  await unsafeCreateEntityTable(stack.db, tenantEntity);
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
  await unsafePushTables(stack.db, { configValuesTable, tenantMembershipsTable });
});

beforeEach(async () => {
  await resetTestTables(stack.db, [
    userTable,
    tenantMembershipsTable,
    tenantTable,
    tenantComplianceProfileTable,
    eventsTable,
  ]);
  resetPiiSubjectKmsForTests();
  configurePiiSubjectKms(new InMemoryKmsAdapter());
});

afterAll(async () => {
  resetPiiSubjectKmsForTests();
  await stack.cleanup();
});

async function createTenant(): Promise<{ id: string; admin: SessionUser }> {
  const created = await stack.http.writeOk<{ id: string }>(
    TenantHandlers.create,
    { key: "zephyr", name: "Zephyr Logistics" },
    creator,
  );
  const id = created.id;
  return { id, admin: createTestUser({ id: 1, tenantId: id, roles: ["TenantAdmin"] }) };
}

describe("compliance-profiles defaultProfile", () => {
  test("a new tenant starts with the default profile and no warning", async () => {
    const { admin } = await createTenant();
    const result = await stack.http.queryOk<ForTenant>(FOR_TENANT, {}, admin);
    expect(result.profile.key).toBe("swiss-dsg");
    expect(result.warning).toBeUndefined();
  });

  test("a tenant update does not write a second profile row", async () => {
    const { id, admin } = await createTenant();
    await stack.http.writeOk(
      TenantHandlers.update,
      { id, changes: { name: "Borealis Freight" }, version: 1 },
      creator,
    );
    const rows = await selectMany<{ profileKey: string }>(stack.db, tenantComplianceProfileTable, {
      tenantId: id,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.profileKey).toBe("swiss-dsg");
    const result = await stack.http.queryOk<ForTenant>(FOR_TENANT, {}, admin);
    expect(result.profile.key).toBe("swiss-dsg");
  });

  test("set-profile overwrites the default", async () => {
    const { admin } = await createTenant();
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, admin);
    const result = await stack.http.queryOk<ForTenant>(FOR_TENANT, {}, admin);
    expect(result.profile.key).toBe("eu-dsgvo");
  });
});
