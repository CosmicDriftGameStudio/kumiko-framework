import { describe, expect, test } from "bun:test";
import { access, createRegistry, validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { createAuditFeature } from "../../audit/feature";
import { createConfigFeature } from "../../config/feature";
import { createJobsFeature } from "../../jobs/feature";
import { createTenantFeature } from "../../tenant/feature";
import { tierEngineFeature } from "../../tier-engine/feature";
import { createUserFeature } from "../../user/feature";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
} from "../constants";
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

describe("admin-shell boot + workspace composition", () => {
  test("validateBoot with user, tenant, audit, jobs, tier-engine", () => {
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("validateBoot fails without user (platform-overview user-count requires it)", () => {
    const withoutUser = [
      createConfigFeature(),
      createTenantFeature(),
      createAuditFeature(),
      createJobsFeature(),
      tierEngineFeature,
      createAdminShellFeature(),
    ];
    expect(() => validateBoot(withoutUser)).toThrow();
  });

  test("registers tenant + platform workspaces with qualified ids", () => {
    const registry = createRegistry(features);
    expect(
      registry.getWorkspace(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`)?.id,
    ).toBe(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`);
    expect(
      registry.getWorkspace(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`)
        ?.id,
    ).toBe(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`);
  });

  test("tenant workspace nav references owner-feature navs", () => {
    const registry = createRegistry(features);
    const navs = registry.getWorkspaceNavs(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`,
    );
    expect(navs).toEqual([
      "admin-shell:nav:tenant-overview",
      "tenant:nav:members",
      "audit:nav:audit-log",
    ]);
  });

  test("platform workspace nav includes overview, tenants, jobs, tier-admin", () => {
    const registry = createRegistry(features);
    const navs = registry.getWorkspaceNavs(
      `${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_PLATFORM_WORKSPACE_ID}`,
    );
    expect(navs).toEqual([
      "admin-shell:nav:platform-overview",
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
      createUserFeature(),
      createTenantFeature(),
      createAuditFeature(),
      createJobsFeature(),
      custom,
    ]);
    expect(registry.getWorkspace("admin-shell:workspace:admin")?.id).toBeDefined();
    expect(registry.getWorkspace("admin-shell:workspace:sysadmin")?.id).toBeDefined();
    expect(registry.getWorkspaceNavs("admin-shell:workspace:sysadmin")).toEqual([
      "admin-shell:nav:platform-overview",
      "admin-shell:nav:tenants",
      "jobs:nav:job-runs",
    ]);
  });

  test("registerWorkspaces:false registers overview screens only", () => {
    const shellOnly = createAdminShellFeature({
      registerWorkspaces: false,
      includeTierAdmin: false,
    });
    const registry = createRegistry([
      createConfigFeature(),
      createUserFeature(),
      createTenantFeature(),
      createAuditFeature(),
      createJobsFeature(),
      shellOnly,
    ]);
    expect(
      registry.getWorkspace(`${ADMIN_SHELL_FEATURE}:workspace:${DEFAULT_TENANT_WORKSPACE_ID}`),
    ).toBeUndefined();
    expect(registry.getScreen("admin-shell:screen:tenant-overview")?.id).toBeDefined();
    expect(registry.getScreen("admin-shell:screen:platform-overview")?.id).toBeDefined();
  });

  test("admin-shell nav entries declare icons (sidebar standard)", () => {
    const shell = createAdminShellFeature({ includeTierAdmin: true });
    const navIds = ["tenant-overview", "platform-overview", "tenants", "tier-admin"] as const;
    for (const id of navIds) {
      expect(shell.navs[id]?.icon, `admin-shell:nav:${id}`).toBeDefined();
    }
  });

  test("admin-shell registers server translations bundle", () => {
    const shell = createAdminShellFeature();
    expect(shell.translations?.["admin-shell:nav.tenantOverview"]?.["de"]).toBe("Übersicht");
    expect(shell.translations?.["screen:tenant-overview.title"]?.["en"]).toBe("Overview");
  });
});
