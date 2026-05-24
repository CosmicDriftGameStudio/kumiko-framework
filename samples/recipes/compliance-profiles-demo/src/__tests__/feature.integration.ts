// Two-tenant compliance-profiles demo (S1.6).
//
// Beweist die Cross-Tenant-Isolation des compliance-profiles-Features:
// gleiche App, zwei Tenants, zwei Profile, zwei effektive Verhalten.
//
// Tenant A (DACH) → eu-dsgvo:
//   - Aufsicht: BlnBDI Berlin
//   - Sprachen: de, en
//   - Grace-Period: 30d
//
// Tenant B (Schweiz) → swiss-dsg (extends eu-dsgvo):
//   - Aufsicht: EDÖB Bern
//   - Sprachen: de, fr, it, en
//   - Grace-Period: 30d (geerbt)
//
// Tenant C (DACH-HR) → de-hr-dsgvo-hgb (extends eu-dsgvo, HR-Override):
//   - Aufsicht: Landes-Datenschutzbehörde
//   - Sprachen: de
//   - Tenant-Destroy-Grace: 60d (HR-Override)
//   - Audit-Retention: 10y (HGB-Override)
//   - Plus worksCouncilApprovalRequired

import { tenantComplianceProfileEntity } from "@cosmicdrift/kumiko-bundled-features/compliance-profiles";
import { createEventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEntityTable,
  createTestUser,
  setupTestStack,
  type TestStack,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { complianceProfilesDemoFeatures } from "../feature";

const SET_PROFILE = "compliance-profiles:write:set-profile";
const FOR_TENANT = "compliance-profiles:query:for-tenant";

let stack: TestStack;

const tenantADachAdmin = createTestUser({
  id: 1,
  tenantId: testTenantId(1),
  roles: ["TenantAdmin"],
});
const tenantBSwissAdmin = createTestUser({
  id: 2,
  tenantId: testTenantId(2),
  roles: ["TenantAdmin"],
});
const tenantCHrAdmin = createTestUser({
  id: 3,
  tenantId: testTenantId(3),
  roles: ["TenantAdmin"],
});

beforeAll(async () => {
  stack = await setupTestStack({ features: complianceProfilesDemoFeatures });
  await createEntityTable(stack.db, tenantComplianceProfileEntity);
  await createEventsTable(stack.db);

  // Onboarding-Setup: jeder Tenant-Admin waehlt sein Profile.
  await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantADachAdmin);
  await stack.http.writeOk(SET_PROFILE, { profileKey: "swiss-dsg" }, tenantBSwissAdmin);
  await stack.http.writeOk(SET_PROFILE, { profileKey: "de-hr-dsgvo-hgb" }, tenantCHrAdmin);
});

afterAll(async () => {
  await stack.cleanup();
});

describe("compliance-profiles-demo :: cross-tenant isolation", () => {
  test("Tenant A (DACH) → eu-dsgvo: BlnBDI + DE/EN-Sprachen", async () => {
    const result = await stack.http.queryOk<{
      profile: {
        key: string;
        breach: { authorityContact: string };
        notifications: { languages: string[] };
        userRights: { gracePeriod: { days: number } };
        tenantDestroyGracePeriod: { days: number };
      };
    }>(FOR_TENANT, {}, tenantADachAdmin);

    expect(result.profile.key).toBe("eu-dsgvo");
    expect(result.profile.breach.authorityContact).toBe("BlnBDI Berlin");
    expect(result.profile.notifications.languages).toEqual(["de", "en"]);
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 30 });
    expect(result.profile.tenantDestroyGracePeriod).toEqual({ days: 30 });
  });

  test("Tenant B (Schweiz) → swiss-dsg: EDÖB + DE/FR/IT/EN-Sprachen", async () => {
    const result = await stack.http.queryOk<{
      profile: {
        key: string;
        breach: { authorityContact: string };
        notifications: { languages: string[] };
        userRights: { gracePeriod: { days: number } };
      };
    }>(FOR_TENANT, {}, tenantBSwissAdmin);

    expect(result.profile.key).toBe("swiss-dsg");
    expect(result.profile.breach.authorityContact).toBe("EDÖB Bern");
    expect(result.profile.notifications.languages).toEqual(["de", "fr", "it", "en"]);
    // Geerbt aus eu-dsgvo via extends:
    expect(result.profile.userRights.gracePeriod).toEqual({ days: 30 });
  });

  test("Tenant C (DACH-HR) → de-hr-dsgvo-hgb: HR-Override greift", async () => {
    const result = await stack.http.queryOk<{
      profile: {
        key: string;
        breach: { authorityContact: string; worksCouncilNotificationRequired?: boolean };
        notifications: { languages: string[] };
        tenantDestroyGracePeriod: { days: number };
        auditLog: { retention: { years?: number } };
        subProcessor: { worksCouncilApprovalRequired?: boolean };
      };
    }>(FOR_TENANT, {}, tenantCHrAdmin);

    expect(result.profile.key).toBe("de-hr-dsgvo-hgb");
    expect(result.profile.breach.authorityContact).toBe("Landes-Datenschutzbehörde");
    expect(result.profile.breach.worksCouncilNotificationRequired).toBe(true);
    expect(result.profile.notifications.languages).toEqual(["de"]);
    expect(result.profile.tenantDestroyGracePeriod).toEqual({ days: 60 });
    expect(result.profile.auditLog.retention).toEqual({ years: 10 });
    expect(result.profile.subProcessor.worksCouncilApprovalRequired).toBe(true);
  });

  test("Profile-Wechsel auf demselben Tenant zeigt sofort neues Verhalten", async () => {
    // Eigener Tenant D damit der Test reihenfolge-unabhaengig laeuft
    // (Tenant A bleibt auf eu-dsgvo fuer die anderen Tests).
    const tenantDAdmin = createTestUser({
      id: 4,
      tenantId: testTenantId(4),
      roles: ["TenantAdmin"],
    });
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantDAdmin);

    // Wechsel von eu-dsgvo auf swiss-dsg
    await stack.http.writeOk(SET_PROFILE, { profileKey: "swiss-dsg" }, tenantDAdmin);
    const after = await stack.http.queryOk<{
      profile: { key: string; breach: { authorityContact: string } };
    }>(FOR_TENANT, {}, tenantDAdmin);
    expect(after.profile.key).toBe("swiss-dsg");
    expect(after.profile.breach.authorityContact).toBe("EDÖB Bern");

    // Zurueck auf eu-dsgvo
    await stack.http.writeOk(SET_PROFILE, { profileKey: "eu-dsgvo" }, tenantDAdmin);
    const back = await stack.http.queryOk<{
      profile: { key: string; breach: { authorityContact: string } };
    }>(FOR_TENANT, {}, tenantDAdmin);
    expect(back.profile.key).toBe("eu-dsgvo");
    expect(back.profile.breach.authorityContact).toBe("BlnBDI Berlin");
  });

  test("Tenant-Override merged auf base-profile, andere Felder bleiben", async () => {
    // Eigener Tenant E damit der Override-State Tenant B nicht
    // ueberschreibt (reihenfolge-unabhaengig).
    const tenantEAdmin = createTestUser({
      id: 5,
      tenantId: testTenantId(5),
      roles: ["TenantAdmin"],
    });
    await stack.http.writeOk(
      SET_PROFILE,
      {
        profileKey: "swiss-dsg",
        override: JSON.stringify({
          userRights: { gracePeriod: { days: 90 } },
        }),
      },
      tenantEAdmin,
    );

    const result = await stack.http.queryOk<{
      profile: {
        userRights: {
          gracePeriod: { days: number };
          portabilityFormat: string[];
          restrictionAllowed: boolean;
        };
        notifications: { languages: string[] };
      };
    }>(FOR_TENANT, {}, tenantEAdmin);

    expect(result.profile.userRights.gracePeriod).toEqual({ days: 90 });
    // Andere userRights aus swiss-dsg bleiben
    expect(result.profile.userRights.portabilityFormat).toEqual(["json"]);
    expect(result.profile.userRights.restrictionAllowed).toBe(true);
    // Sprachen aus swiss-dsg unverändert
    expect(result.profile.notifications.languages).toEqual(["de", "fr", "it", "en"]);
  });
});
