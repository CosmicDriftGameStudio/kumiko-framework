// admin-shell — role-gated workspaces + provider nav for tenant vs platform operators.
// Screens live in owner features (tenant, audit, jobs, …); this feature only
// composes workspaces and cross-feature nav entries.

import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { ConfigQueries } from "../config/constants";
import { JobQueries } from "../jobs/constants";
import { TenantQueries } from "../tenant/constants";
import { UserQueries } from "../user/constants";
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
  /** Tenant nav → cap-overview:screen:my-caps, platform nav → cap-overview:screen:tenant-cap-list.
   *  Requires cap-overview mounted. Default false — apps that don't mount cap-overview
   *  must not get a nav entry pointing at a screen that doesn't exist. */
  readonly includeCapOverview?: boolean;
  /** When false, only overview screens + nav are registered — app owns r.workspace(). Default true. */
  readonly registerWorkspaces?: boolean;
};

export function createAdminShellFeature(options: CreateAdminShellOptions = {}): FeatureDefinition {
  const tenantWsId = options.workspaceIds?.tenant ?? DEFAULT_TENANT_WORKSPACE_ID;
  const platformWsId = options.workspaceIds?.platform ?? DEFAULT_PLATFORM_WORKSPACE_ID;
  const includeTierAdmin = options.includeTierAdmin ?? true;
  const includeCapOverview = options.includeCapOverview ?? false;
  const registerWorkspaces = options.registerWorkspaces ?? true;

  return defineFeature(ADMIN_SHELL_FEATURE, (r) => {
    r.describe(
      "Registers tenant-admin and platform-admin workspaces with provider nav into owner-feature screens (`tenant:screen:members`, `audit:screen:audit-log`, `tenant:screen:tenant-list`, `jobs:screen:job-runs`, optional `tier-engine:screen:tier-admin`, optional `cap-overview:screen:my-caps`/`cap-overview:screen:tenant-cap-list`). Mount after user, tenant, audit, and jobs; pass `workspaceIds` to match app URL conventions (e.g. Studio `d`/`s`, PublicStatus `admin`/`sysadmin`). Client: `adminShellClient()`, `tenantClient()`, `auditClient()`, `jobsClient()`, optional `tierEngineClient()`.",
    );
    r.uiHints({
      displayLabel: "Admin Shell",
      category: "operations",
      recommended: false,
    });
    r.requires("user");
    r.requires("tenant");
    r.requires("audit");
    r.requires("jobs");
    if (includeTierAdmin) r.requires("tier-engine");
    if (includeCapOverview) r.requires("cap-overview");

    r.translations({ keys: ADMIN_SHELL_I18N });

    const tenantNav: string[] = [
      "admin-shell:nav:tenant-overview",
      "tenant:nav:members",
      "audit:nav:audit-log",
      ...(includeCapOverview ? (["admin-shell:nav:my-caps"] as const) : []),
    ];
    const platformNav: string[] = [
      "admin-shell:nav:platform-overview",
      "admin-shell:nav:tenants",
      ...(includeCapOverview ? (["admin-shell:nav:tenant-caps"] as const) : []),
      "jobs:nav:job-runs",
      ...(includeTierAdmin ? (["admin-shell:nav:tier-admin"] as const) : []),
    ];

    r.screen({
      id: TENANT_OVERVIEW_SCREEN_ID,
      type: "dashboard",
      access: { roles: access.admin },
      description:
        "Landing page of the tenant-admin workspace, showing pending invitation, member and missing-config counts for the caller's own tenant so an operator sees what needs attention there.",
      panels: [
        {
          kind: "stat",
          id: "pending-invitations",
          label: "admin-shell:overview.pendingInvitations",
          query: TenantQueries.invitations,
          // tenant:query:invitations returns a bare array, not a paged
          // envelope — "length" reads record["length"], i.e. the array's
          // own .length. Not a typo.
          valueField: "length",
        },
        {
          kind: "stat",
          id: "members",
          label: "admin-shell:overview.members",
          query: TenantQueries.members,
          // Same array-shaped response as invitations above.
          valueField: "length",
        },
        {
          kind: "stat",
          id: "missing-config",
          label: "admin-shell:overview.missingConfig",
          query: ConfigQueries.readiness,
          valueField: "missingCount",
          toneField: "missingTone",
        },
      ],
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
      type: "dashboard",
      access: { roles: access.systemAdmin },
      description:
        "Landing page of the platform-admin workspace, showing installation-wide tenant, user and failed-job counts so a system admin sees the health of the whole deployment at a glance.",
      panels: [
        {
          kind: "stat",
          id: "tenants",
          label: "admin-shell:overview.tenants",
          query: TenantQueries.list,
          params: { totalCount: true },
          valueField: "total",
        },
        {
          kind: "stat",
          id: "users",
          label: "admin-shell:overview.users",
          query: UserQueries.list,
          params: { totalCount: true },
          valueField: "total",
        },
        {
          kind: "stat",
          id: "failed-jobs",
          label: "admin-shell:overview.failedJobs",
          query: JobQueries.list,
          params: { status: "failed", totalCount: true },
          valueField: "total",
        },
      ],
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

    if (includeCapOverview) {
      r.nav({
        id: "my-caps",
        label: "admin-shell:nav.myCaps",
        icon: "gauge",
        screen: "cap-overview:screen:my-caps",
        access: { roles: access.admin },
        order: 20,
      });
      r.nav({
        id: "tenant-caps",
        label: "admin-shell:nav.tenantCaps",
        icon: "gauge",
        screen: "cap-overview:screen:tenant-cap-list",
        access: { roles: access.systemAdmin },
        order: 20,
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
