import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { rolesOf } from "@cosmicdrift/kumiko-framework/testing";
import { createConfigFeature } from "../../config";
import { createTenantFeature } from "../../tenant/feature";
import type { TierMap } from "../compose-app";
import { TIER_ADMIN_SCREEN_ID } from "../constants";
import { createTierEngineFeature } from "../feature";

const SYSTEM_ADMIN_ROLES = ["SystemAdmin"] as const;

type TestCaps = { readonly maxItems: number };
const TEST_TIER_MAP: TierMap<TestCaps> = {
  free: { features: [], caps: { maxItems: 1 } },
  pro: { features: ["feat-pro"], caps: { maxItems: 5 } },
};

describe("tier-engine tier-admin screen + handler access alignment", () => {
  test("boot-validates with the tier-admin actionForm registered (tierMap configured)", () => {
    const features = [
      createConfigFeature(),
      createTenantFeature(),
      createTierEngineFeature({ tierMap: TEST_TIER_MAP }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("boot-validates in storage-only mode with tier-admin screen showing the no-tiers message (no tierMap)", () => {
    const features = [createConfigFeature(), createTenantFeature(), createTierEngineFeature()];
    expect(() => validateBoot(features)).not.toThrow();
    const tierEngine = createTierEngineFeature();
    const screen = tierEngine.screens[TIER_ADMIN_SCREEN_ID];
    expect(screen).toBeDefined();
    if (screen && "layout" in screen) {
      expect(screen.layout.sections[0]).toMatchObject({ description: "tier-admin.error.noTiers" });
    }
    if (screen && "fields" in screen) {
      expect(screen.fields["tier"]).toEqual({ type: "select", options: [], required: true });
    }
  });

  test("tier-admin is a SystemAdmin-gated actionForm dispatching set-tenant-tier", () => {
    const tierEngine = createTierEngineFeature({ tierMap: TEST_TIER_MAP });
    const screen = tierEngine.screens[TIER_ADMIN_SCREEN_ID];
    expect(screen?.type).toBe("actionForm");
    if (screen && "handler" in screen) {
      expect(screen.handler).toBe("tier-engine:write:set-tenant-tier");
    }
    if (screen && "access" in screen && screen.access && "roles" in screen.access) {
      expect(screen.access.roles).toEqual(SYSTEM_ADMIN_ROLES);
    }
    if (screen && "layout" in screen) {
      expect(screen.layout.sections[0]).toMatchObject({ description: "tier-admin.explainer" });
    }
  });

  test("tier-admin's tier field options come from the tierMap", () => {
    const tierEngine = createTierEngineFeature({ tierMap: TEST_TIER_MAP });
    const screen = tierEngine.screens[TIER_ADMIN_SCREEN_ID];
    if (screen && "fields" in screen) {
      expect(screen.fields["tier"]).toEqual({
        type: "select",
        options: ["free", "pro"],
        required: true,
      });
      expect(screen.fields["tenantId"]).toEqual({
        type: "reference",
        entity: "tenant:tenant",
        labelField: "name",
        required: true,
      });
    }
  });

  test("set-tenant-tier write + get-tenant-tier/tier-options reads stay SystemAdmin-only", () => {
    const tierEngine = createTierEngineFeature({ tierMap: TEST_TIER_MAP });
    const roles = [...SYSTEM_ADMIN_ROLES];
    expect(rolesOf(tierEngine.writeHandlers["set-tenant-tier"]?.access)).toEqual(roles);
    expect(rolesOf(tierEngine.queryHandlers["get-tenant-tier"]?.access)).toEqual(roles);
    expect(rolesOf(tierEngine.queryHandlers["tier-options"]?.access)).toEqual(roles);
  });
});
