import { describe, expect, test } from "bun:test";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { COMPLIANCE_PROFILE_SCREEN_ID, ComplianceProfileHandlers } from "../constants";
import { createComplianceProfilesFeature } from "../feature";

describe("compliance profile screen + handler access alignment", () => {
  const features = [createComplianceProfilesFeature()];

  test("boot-validates with profile-picker screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("profile-picker screen is custom, access.admin-gated", () => {
    const feature = createComplianceProfilesFeature();
    const screen = feature.screens[COMPLIANCE_PROFILE_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(access.admin);
    }
  });

  test("set-profile handler shares access.admin", () => {
    const feature = createComplianceProfilesFeature();
    expect(rolesOf(feature.writeHandlers["set-profile"]?.access)).toEqual([...access.admin]);
    void ComplianceProfileHandlers;
  });
});
