import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import {
  FeatureToggleHandlers,
  FeatureToggleQueries,
  TOGGLE_ADMIN_SCREEN_ID,
} from "../constants";
import { createFeatureTogglesFeature } from "../feature";

describe("feature-toggles screen + handler access alignment", () => {
  const features = [createFeatureTogglesFeature()];

  test("boot-validates with toggle-admin screen registered", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("toggle-admin screen is SystemAdmin-gated", () => {
    const toggles = createFeatureTogglesFeature();
    const screen = toggles.screens[TOGGLE_ADMIN_SCREEN_ID];
    expect(screen?.type).toBe("custom");
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(["SystemAdmin"]);
    }
  });

  test("queries and set handler are SystemAdmin-only", () => {
    const toggles = createFeatureTogglesFeature();
    expect(rolesOf(toggles.queryHandlers["list"]?.access)).toEqual(["SystemAdmin"]);
    expect(rolesOf(toggles.queryHandlers["registered"]?.access)).toEqual(["SystemAdmin"]);
    expect(rolesOf(toggles.writeHandlers["set"]?.access)).toEqual(["SystemAdmin"]);
    void FeatureToggleQueries;
    void FeatureToggleHandlers;
  });
});
