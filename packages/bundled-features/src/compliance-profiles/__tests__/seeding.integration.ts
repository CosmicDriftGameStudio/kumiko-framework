// seedComplianceProfile-Helper-Tests (S1.9 Z2).
//
// Beweist:
//   1. Helper umgeht set-profile-Zod-Engung (kann minimal-no-region
//      setzen für Migration-Edge-Case-Tests in Sprint 2+)
//   2. Idempotent: zweiter Call mit gleichem tenantId updated den
//      bestehenden Eintrag
//   3. Override wird als JSON-String persistiert + via for-tenant
//      korrekt zurueckgelesen

import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createComplianceProfilesFeature, tenantComplianceProfileEntity } from "../feature";
import { seedComplianceProfile } from "../seeding";

const FOR_TENANT = "compliance-profiles:query:for-tenant";

let stack: TestStack;

const feature = createComplianceProfilesFeature();

beforeAll(async () => {
  stack = await setupTestStack({ features: [feature] });
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);
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

  test("idempotent: zweiter Call updated den bestehenden Eintrag", async () => {
    const tenantId = testTenantId(201);
    const user = createTestUser({ id: 201, tenantId, roles: ["TenantAdmin"] });

    await seedComplianceProfile(stack.db, { tenantId, profileKey: "eu-dsgvo" });
    await seedComplianceProfile(stack.db, { tenantId, profileKey: "swiss-dsg" });

    const result = await stack.http.queryOk<{ profile: { key: string } }>(FOR_TENANT, {}, user);
    expect(result.profile.key).toBe("swiss-dsg");
  });

  test("kann minimal-no-region direkt seeden (Migration-Edge-Case, ohne set-profile-Zod-Engung)", async () => {
    const tenantId = testTenantId(202);
    const user = createTestUser({ id: 202, tenantId, roles: ["TenantAdmin"] });

    // set-profile (Sprint 1.7 X1) wuerde minimal-no-region rejecten —
    // seedComplianceProfile umgeht das fuer Test-Migration-Szenarien.
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
    // Andere userRights bleiben aus eu-dsgvo
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
  });
});
