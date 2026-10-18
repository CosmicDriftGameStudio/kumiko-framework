import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-testing/helpers";
import { createComplianceProfilesFeature } from "../../compliance-profiles/index.ts";
import { createConfigFeature } from "../../config/feature.ts";
import { createTenantFeature } from "../../tenant/feature.ts";
import { createComplianceProfilesOpsFeature } from "../index.ts";

describe("compliance-profiles-ops (#2089)", () => {
  test("declares systemScope and requires compliance-profiles + tenant", () => {
    expect(createComplianceProfilesOpsFeature().systemScope).toBe(true);
    expect(createComplianceProfilesOpsFeature().requires).toContain("compliance-profiles");
    expect(createComplianceProfilesOpsFeature().requires).toContain("tenant");
  });

  test("tenants-missing-profile is SystemAdmin-only", () => {
    expect(
      rolesOf(
        createComplianceProfilesOpsFeature().queryHandlers["tenants-missing-profile"]?.access,
      ),
    ).toEqual(["SystemAdmin"]);
  });

  test("boot-validates alongside compliance-profiles + tenant + config", () => {
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createTenantFeature(),
        createComplianceProfilesFeature(),
        createComplianceProfilesOpsFeature(),
      ]),
    ).not.toThrow();
  });

  test("boot fails without tenant mounted (hard requires)", () => {
    expect(() =>
      validateBoot([
        createConfigFeature(),
        createComplianceProfilesFeature(),
        createComplianceProfilesOpsFeature(),
      ]),
    ).toThrow();
  });
});
