// Boot-Smoke-Test fuer user-data-rights (S2.U2).
//
// Pre-Commit-Checkliste-Item: Neues Feature → 5-Zeilen-Boot-Smoke-Test.
// Faengt Drift an Schema-Definition oder Boot-Validation frueh.
//
// Tieferer Cross-Feature-Test (mit useExtension(EXT_USER_DATA, ...) +
// Sprint-2-H1/H2-Hooks) kommt in S2.T1 (Cross-Data-Matrix).

import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createDataRetentionFeature } from "../../data-retention";
import { createUserFeature } from "../../user";
import { createUserDataRightsFeature } from "../feature";

let stack: TestStack;

const userFeature = createUserFeature();
const dataRetention = createDataRetentionFeature();
const complianceProfiles = createComplianceProfilesFeature();
const userDataRights = createUserDataRightsFeature();

beforeAll(async () => {
  stack = await setupTestStack({
    features: [userFeature, dataRetention, complianceProfiles, userDataRights],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("user-data-rights :: feature-definition smoke", () => {
  test("Feature laedt clean (requires user + data-retention + compliance-profiles)", () => {
    expect(stack).toBeDefined();
    expect(userDataRights.name).toBe("user-data-rights");
  });

  test("EXT_USER_DATA-Extension ist registriert (andere Features koennen useExtension dranhaengen)", () => {
    expect(userDataRights.registrarExtensions["userData"]).toBeDefined();
  });

  test("requires user + data-retention + compliance-profiles", () => {
    const requires = userDataRights.requires;
    expect(requires).toContain("user");
    expect(requires).toContain("data-retention");
    expect(requires).toContain("compliance-profiles");
  });

  test("usesApi compliance.forTenant fuer Grace-Period-Resolution", () => {
    expect(userDataRights.usedApis.has("compliance.forTenant")).toBe(true);
  });

  test("usesApi retention.policyFor fuer blockDelete-Konsultation (S2.D3 wired)", () => {
    expect(userDataRights.usedApis.has("retention.policyFor")).toBe(true);
  });
});
