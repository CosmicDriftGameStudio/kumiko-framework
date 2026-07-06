// admin-shell — role-gated workspaces + provider nav for tenant vs platform operators.
// Screens live in owner features (tenant, audit, jobs, …); this feature only
// composes workspaces and cross-feature nav entries.

import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
  PLATFORM_OVERVIEW_SCREEN_ID,
  TENANT_OVERVIEW_SCREEN_ID,
} from "./constants";
import { ADMIN_SHELL_I18N } from "./i18n";

export type CreateAdminShellOptions = {
  /** Short workspace id for tenant operators (URL segment). Default `tenant-admin`. */
  readonly workspaceIds?: {
    readonly tenant?: string;
    readonly platform?: string;
  };
  /** Platform nav → tier-engine:screen:tier-admin. Requires tier-engine mounted. Default true. */
  readonly includeTierAdmin?: boolean;
  /** When false, only overview screens + nav are registered — app owns r.workspace(). Default true. */
  readonly registerWorkspaces?: boolean;
};

export function createAdminShellFeature(
  options: CreateAdminShellOptions = {},
): FeatureDefinition {
  const tenantWsId = options.workspaceIds?.tenant ?? DEFAULT_TENANT_WORKSPACE_ID;
  const platformWsId = options.workspaceIds?.platform ?? DEFAULT_PLATFORM_WORKSPACE_ID;
  const includeTierAdmin = options.includeTierAdmin ?? true;
  const registerWorkspaces = options.registerWorkspaces ?? true;

  return defineFeature(ADMIN_SHELL_FEATURE, (r) => {
    r.describe(
      "Registers tenant-admin and platform-admin workspaces with provider nav into owner-feature screens (`tenant:screen:members`, `audit:screen:audit-log`, `tenant:screen:tenant-list`, `jobs:screen:job-runs`, optional `tier-engine:screen:tier-admin`). Mount after tenant, audit, and jobs; pass `workspaceIds` to match app URL conventions (e.g. Studio `d`/`s`, PublicStatus `admin`/`sysadmin`). Client: `adminShellClient()`, `tenantClient()`, `auditClient()`, `jobsClient()`, optional `tierEngineClient()`.",
    );
    r.uiHints({
      displayLabel: "Admin Shell",
      category: "operations",
      recommended: false,
    });
    r.requires("tenant");
    r.requires("audit");
    r.requires("jobs");
    if (includeTierAdmin) r.requires("tier-engine");

    r.translations({ keys: ADMIN_SHELL_I18N });

    const tenantNav = [
      "admin-shell:nav:tenant-overview",
      "tenant:nav:members",
      "audit:nav:audit-log",
    ] as const;
    const platformNav: string[] = [
      "admin-shell:nav:platform-overview",
      "admin-shell:nav:tenants",
      "jobs:nav:job-runs",
      ...(includeTierAdmin ? (["admin-shell:nav:tier-admin"] as const) : []),
    ];

    r.screen({
      id: TENANT_OVERVIEW_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "TenantOverviewScreen" } },
      access: { roles: access.admin },
    });
    r.nav({
      id: "tenant-overview",
      label: "admin-shell:nav.tenantOverview",
      icon: "home",
      screen: "admin-shell:screen:tenant-overview",
      order: 1,
    });

    r.screen({
      id: PLATFORM_OVERVIEW_SCREEN_ID,
      type: "custom",
      renderer: { react: { __component: "PlatformOverviewScreen" } },
      access: { roles: access.systemAdmin },
    });
    r.nav({
      id: "platform-overview",
      label: "admin-shell:nav.platformOverview",
      icon: "dashboard",
      screen: "admin-shell:screen:platform-overview",
      order: 1,
    });

    r.nav({
      id: "tenants",
      label: "admin-shell:nav.tenants",
      icon: "building",
      screen: "tenant:screen:tenant-list",
      access: { roles: access.systemAdmin },
      order: 10,
    });

    if (includeTierAdmin) {
      r.nav({
        id: "tier-admin",
        label: "admin-shell:nav.tierAdmin",
        icon: "shield",
        screen: "tier-engine:screen:tier-admin",
        access: { roles: access.systemAdmin },
        order: 30,
      });
    }

    if (registerWorkspaces) {
      r.workspace({
        id: tenantWsId,
        label: "admin-shell:workspace.tenant",
        icon: "users",
        order: 1,
        access: { roles: access.admin },
        nav: [...tenantNav],
        default: true,
      });

      r.workspace({
        id: platformWsId,
        label: "admin-shell:workspace.platform",
        icon: "shield",
        order: 2,
        access: { roles: access.systemAdmin },
        nav: platformNav,
      });
    }
  });
}
