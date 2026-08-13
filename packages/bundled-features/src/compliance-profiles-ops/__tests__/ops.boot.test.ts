import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant/feature";
import { complianceProfilesOpsFeature } from "../index";

describe("compliance-profiles-ops (#2089)", () => {
  test("declares systemScope and requires compliance-profiles + tenant", () => {
    expect(complianceProfilesOpsFeature.systemScope).toBe(true);
    expect(complianceProfilesOpsFeature.requires).toContain("compliance-profiles");
    expect(complianceProfilesOpsFeature.requires).toContain("tenant");
  });

  test("tenants-missing-profile is SystemAdmin-only", () => {
    expect(
      rolesOf(complianceProfilesOpsFeature.queryHandlers["tenants-missing-profile"]?.access),
    ).toEqual(["SystemAdmin"]);
  });

  test("boot-validates alongside compliance-profiles + tenant + config", () => {
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        complianceProfilesOpsFeature,
      ]),
    ).not.toThrow();
  });

  test("boot fails without tenant mounted (hard requires)", () => {
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createComplianceProfilesFeature(),
        complianceProfilesOpsFeature,
      ]),
    ).toThrow();
  });
});
