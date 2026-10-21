// Boot smoke test for user-data-rights.
//
// Pre-commit checklist item: each new feature gets a five-line boot smoke test.
// Catches drift in the schema definition or boot validation early.
//
// A deeper cross-feature test using useExtension(EXT_USER_DATA, ...) and
// the H1/H2 hooks is covered separately in the cross-data matrix.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createAuthFoundationFeature } from "@cosmicdrift/kumiko-bundled-features/auth-foundation";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createDataRetentionFeature } from "../../data-retention/index.ts";
import { createSessionsFeature } from "../../sessions/index.ts";
import { createUserFeature } from "../../user/index.ts";
import { createUserDataRightsFeature } from "../feature.ts";

let stack: TestStack;

const userFeature = createUserFeature();
const dataRetention = createDataRetentionFeature();
const complianceProfiles = createComplianceProfilesFeature();
const sessionsFeature = createSessionsFeature();
const userDataRights = createUserDataRightsFeature();

beforeAll(async () => {
  stack = await setupTestStack({
    features: [
      createAuthFoundationFeature(),
      userFeature,
      sessionsFeature,
      dataRetention,
      complianceProfiles,
      userDataRights,
    ],
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
