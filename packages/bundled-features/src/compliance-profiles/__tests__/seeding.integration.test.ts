// seedComplianceProfile helper tests.
//
// Proves:
//   1. The helper bypasses the set-profile Zod restriction, allowing
//      minimal-no-region for migration edge-case tests.
//   2. By default, a second boot call without ifExists="update" changes nothing.
//   3. The override is persisted as a JSON string and correctly read back via
//      for-tenant.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/db";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { createTestUser, testTenantId } from "@cosmicdrift/kumiko-framework/seeding";
import {
  setupTestStack,
  type TestStack,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../feature.ts";
import {
  tenantComplianceProfileEntity,
  tenantComplianceProfileTable,
} from "../schema/profile-selection.ts";
import { seedComplianceProfile } from "../seeding.ts";

const FOR_TENANT = "compliance-profiles:query:for-tenant";

let stack: TestStack;

const feature = createComplianceProfilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await unsafeCreateEntityTable(stack.db, tenantComplianceProfileEntity);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("seedComplianceProfile", () => {
  test("kann eu-dsgvo direkt seeden, for-tenant liefert das Profile", async () => {
    const tenantId = testTenantId(200);
    const user = createTestUser({ id: 200, tenantId, roles: ["TenantAdmin"] });

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });

    const result = await stack.http.queryOk<{ profile: { key: string } }>(FOR_TENANT, {}, user);
    expect(result.profile.key).toBe("eu-dsgvo");
  });

  test('ifExists="update" overwrites bestehenden Eintrag', async () => {
    const tenantId = testTenantId(201);
    const user = createTestUser({ id: 201, tenantId, roles: ["TenantAdmin"] });

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });
    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "swiss-dsg",
      ifExists: "update",
    });

    const result = await stack.http.queryOk<{ profile: { key: string } }>(FOR_TENANT, {}, user);
    expect(result.profile.key).toBe("swiss-dsg");
  });

  test("default skip: zweiter Boot-Call ohne update überschreibt nicht", async () => {
    const tenantId = testTenantId(204);

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });
    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "swiss-dsg",
      ifExists: "update",
    });
    await seedComplianceProfile(stack.db, { tenantId, profileKey: "de-hr-dsgvo-hgb" });

    const row = (await fetchOne(stack.db, tenantComplianceProfileTable, {
      tenantId,
    })) as { id: string; profileKey: string; version: number };
    expect(row.profileKey).toBe("swiss-dsg");
    expect(row.version).toBe(2);

    const events = await selectMany(stack.db, eventsTable, { aggregateId: row.id });
    expect(events).toHaveLength(2);
  });

  test("kann minimal-no-region direkt seeden (Migration-Edge-Case, ohne set-profile-Zod-Engung)", async () => {
    const tenantId = testTenantId(202);
    const user = createTestUser({ id: 202, tenantId, roles: ["TenantAdmin"] });

    // set-profile would reject minimal-no-region —
    // seedComplianceProfile bypasses this for migration test scenarios.
    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "minimal-no-region",
    });

    const result = await stack.http.queryOk<{ profile: { key: string } }>(FOR_TENANT, {}, user);
    expect(result.profile.key).toBe("minimal-no-region");
  });

  test("Override wird persistiert + im for-tenant deep-merged zurueckgelesen", async () => {
    const tenantId = testTenantId(203);
    const user = createTestUser({ id: 203, tenantId, roles: ["TenantAdmin"] });

    await seedComplianceProfile(stack.db, {
      tenantId,
      profileKey: "eu-dsgvo",
      override: { userRights: { gracePeriod: { days: 90 } } },
    });

    const result = await stack.http.queryOk<{
      profile: { userRights: { gracePeriod: { days: number }; portabilityFormat: string[] } };
    }>(FOR_TENANT, {}, user);
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 90 });
    // Other userRights remain from eu-dsgvo
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
  });
});
