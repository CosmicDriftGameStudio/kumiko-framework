import { describe, expect, test } from "bun:test";
import { access, createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../../audit/feature";
import { createConfigFeature } from "../../config/feature";
import { createJobsFeature } from "../../jobs/feature";
import { createTenantFeature } from "../../tenant/feature";
import { tierEngineFeature } from "../../tier-engine/feature";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
} from "../constants";
import { createAdminShellFeature } from "../feature";

const features = [
  createConfigFeature(),
  createTenantFeature(),
  createAuditFeature(),
  createJobsFeature(),
  tierEngineFeature,
  createAdminShellFeature(),
];

describe("admin-shell boot + workspace composition", () => {
  test("validateBoot with tenant, audit, jobs, tier-engine", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("registers tenant + platform workspaces with qualified ids", () => {
    const registry = createRegistry(features);
    expect(registry.getWorkspace(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`)?.id).toBe(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`,
    );
    expect(registry.getWorkspace(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`)?.id).toBe(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`,
    );
  });

  test("tenant workspace nav references owner-feature navs", () => {
    const registry = createRegistry(features);
    const navs = registry.getWorkspaceNavs(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`,
    );
    expect(navs).toEqual(["tenant:nav:members", "audit:nav:audit-log"]);
  });

  test("platform workspace nav includes tenants, jobs, tier-admin", () => {
    const registry = createRegistry(features);
    const navs = registry.getWorkspaceNavs(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`,
    );
    expect(navs).toEqual([
      "admin-shell:nav:tenants",
      "jobs:nav:job-runs",
      "admin-shell:nav:tier-admin",
    ]);
  });

  test("workspace access: tenant=access.admin, platform=systemAdmin", () => {
    const registry = createRegistry(features);
    const tenantWs = registry.getWorkspace(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`,
    );
    const platformWs = registry.getWorkspace(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`,
    );
    expect(tenantWs?.access).toEqual({ roles: access.admin });
    expect(platformWs?.access).toEqual({ roles: access.systemAdmin });
    expect(tenantWs?.default).toBe(true);
  });

  test("custom workspace ids via options", () => {
    const custom = createAdminShellFeature({
      workspaceIds: { tenant: "admin", platform: "sysadmin" },
      includeTierAdmin: false,
    });
    const registry = createRegistry([
      createConfigFeature(),
      createTenantFeature(),
      createAuditFeature(),
      createJobsFeature(),
      custom,
    ]);
    expect(registry.getWorkspace("admin-shell:workspace:admin")?.id).toBeDefined();
    expect(registry.getWorkspace("admin-shell:workspace:sysadmin")?.id).toBeDefined();
    expect(registry.getWorkspaceNavs("admin-shell:workspace:sysadmin")).toEqual([
      "admin-shell:nav:tenants",
      "jobs:nav:job-runs",
    ]);
  });
});
