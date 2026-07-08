import { describe, expect, test } from "bun:test";
import { access, createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../../audit/feature";
import { createConfigFeature } from "../../config/feature";
import { createJobsFeature } from "../../jobs/feature";
import { createTenantFeature } from "../../tenant/feature";
import { tierEngineFeature } from "../../tier-engine/feature";
import { createUserFeature } from "../../user/feature";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../constants";
import { createAdminShellFeature } from "../feature";

const features = [
  createConfigFeature(),
  createUserFeature(),
  createTenantFeature(),
  createAuditFeature(),
  createJobsFeature(),
  tierEngineFeature,
  createAdminShellFeature(),
];

describe("overview screens boot", () => {
  test("tenant-overview screen is access.admin", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen(`admin-shell:screen:${TENANT_OVERVIEW_SCREEN_ID}`);
    expect(screen?.access).toEqual({ roles: access.admin });
    expect(screen?.type).toBe("custom");
  });

  test("platform-overview screen is SystemAdmin-only", () => {
    const registry = createRegistry(features);
    const screen = registry.getScreen(`admin-shell:screen:${PLATFORM_OVERVIEW_SCREEN_ID}`);
    expect(screen?.access).toEqual({ roles: access.systemAdmin });
  });
});
