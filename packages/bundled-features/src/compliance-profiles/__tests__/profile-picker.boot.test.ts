import { describe, expect, test } from "bun:test";
import { SELECTABLE_PROFILE_KEYS } from "@cosmicdrift/kumiko-framework/compliance";
import { access, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { COMPLIANCE_PROFILE_SCREEN_ID, ComplianceProfileHandlers } from "../constants";
import { createComplianceProfilesFeature } from "../feature";

describe("compliance profile screen + handler access alignment", () => {
  const features = [createComplianceProfilesFeature()];

  test("boot-validates with profile-picker screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("profile-picker screen is an actionForm wired to set-profile, access.admin-gated", () => {
    const feature = createComplianceProfilesFeature();
    const screen = feature.screens[COMPLIANCE_PROFILE_SCREEN_ID];
    expect(screen?.type).toBe("actionForm");
    expect(rolesOf(screen?.access)).toEqual([...access.admin]);
    if (screen?.type !== "actionForm") throw new Error("expected actionForm screen");
    expect(screen.handler).toBe(ComplianceProfileHandlers.setProfile);
    // Same choosable set the write-handler's zod schema enforces — a screen
    // option outside SELECTABLE_PROFILE_KEYS would let a user pick a value
    // the server always rejects.
    const profileField = screen.fields["profileKey"] as { readonly options?: readonly string[] };
    expect(profileField.options).toEqual([...SELECTABLE_PROFILE_KEYS]);
  });

  test("set-profile handler shares access.admin", () => {
    const feature = createComplianceProfilesFeature();
    expect(rolesOf(feature.writeHandlers["set-profile"]?.access)).toEqual([...access.admin]);
    void ComplianceProfileHandlers;
  });

  test("access option narrows the profile-picker screen and its set-profile handler together (#2033)", () => {
    const feature = createComplianceProfilesFeature({ access: access.systemAdmin });
    const screen = feature.screens[COMPLIANCE_PROFILE_SCREEN_ID];
    expect(rolesOf(screen?.access)).toEqual([...access.systemAdmin]);
    expect(rolesOf(feature.writeHandlers["set-profile"]?.access)).toEqual([...access.systemAdmin]);
  });

  test("boot-validates with a narrowed access option", () => {
    expect(() =>
      validateBoot([createComplianceProfilesFeature({ access: access.systemAdmin })]),
    ).not.toThrow();
  });
});
