import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "@cosmicdrift/kumiko-framework/bun-db";
import { access } from "@cosmicdrift/kumiko-framework/engine";
import {
  createTestUser,
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-framework/stack";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import {
  COMPLIANCE_PROFILE_SCREEN_ID,
  ComplianceProfileHandlers,
  ComplianceProfileQueries,
} from "../constants";
import { createComplianceProfilesFeature } from "../feature";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection";

let stack: TestStack;

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createComplianceProfilesFeature()],
  });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await asRawClient(stack.db).unsafe(`DELETE FROM "${tenantComplianceProfileTable.tableName}"`);
});

describe("compliance-profiles access matrix", () => {
  test("set-profile handler and screen share access.admin", () => {
    expect(
      rolesOf(stack.registry.getWriteHandler(ComplianceProfileHandlers.setProfile)?.access),
    ).toEqual([...access.admin]);
    const feature = createComplianceProfilesFeature();
    const screen = feature.screens[COMPLIANCE_PROFILE_SCREEN_ID];
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });
});

describe("compliance profile HTTP access", () => {
  test("historic Admin can set a profile for own tenant", async () => {
    const admin = createTestUser({ id: 31, roles: ["Admin"] });
    const res = await stack.http.writeOk<{ profileKey: string; isNew: boolean }>(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "eu-dsgvo" },
      admin,
    );
    expect(res.profileKey).toBe("eu-dsgvo");
    const current = await stack.http.queryOk<{ profile: { key: string } }>(
      ComplianceProfileQueries.forTenant,
      {},
      admin,
    );
    expect(current.profile.key).toBe("eu-dsgvo");
  });

  test("TenantAdmin can set a profile for own tenant", async () => {
    const admin = createTestUser({ id: 32, roles: ["TenantAdmin"] });
    const res = await stack.http.writeOk<{ profileKey: string }>(
      ComplianceProfileHandlers.setProfile,
      { profileKey: "swiss-dsg" },
      admin,
    );
    expect(res.profileKey).toBe("swiss-dsg");
  });

  test("regular User gets 403 on set-profile", async () => {
    const user = createTestUser({ id: 33, roles: ["User"] });
    expect(
      (
        await stack.http.write(
          ComplianceProfileHandlers.setProfile,
          { profileKey: "eu-dsgvo" },
          user,
        )
      ).status,
    ).toBe(403);
  });
});
