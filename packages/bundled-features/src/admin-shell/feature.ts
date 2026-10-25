// admin-shell — role-gated workspaces + provider nav for tenant vs platform operators.
// Screens live in owner features (tenant, audit, jobs, …); this feature only
// composes workspaces and cross-feature nav entries.

import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_METRICS, type MetricDefinition } from "../metrics/index.ts";
import {
  OVERVIEW_TIME_RANGE,
  PLATFORM_SCOPE,
  PLATFORM_TENANT_FILTER,
  platformOverviewPanels,
  tenantOverviewPanels,
} from "./overview-panels.ts";
import {
  ADMIN_SHELL_FEATURE,
  DEFAULT_PLATFORM_WORKSPACE_ID,
  DEFAULT_TENANT_WORKSPACE_ID,
  PLATFORM_OVERVIEW_SCREEN_ID,
  TENANT_OVERVIEW_SCREEN_ID,
} from "./web/constants.ts";
import { ADMIN_SHELL_I18N } from "./web/i18n.ts";

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
  /** Tenant nav → document-designer:nav:templates, platform nav → document-designer:nav:platform-templates.
   *  Requires document-designer mounted (a separate package, so no import here). Default false. */
  readonly includeDocumentDesigner?: boolean;
  /** Tenant overview dashboard: screen, nav and the entry in the tenant workspace. Default true.
   *  Set false when the app ships its own landing screen for tenant admins. */
  readonly includeTenantOverview?: boolean;
  /** When false, only overview screens + nav are registered — app owns r.workspace(). Default true. */
  readonly registerWorkspaces?: boolean;
  /** Metric list the overview panels are built from — pass the SAME list to
   *  createMetricsFeature / createSystemMetricsFeature. Panels exist only for
   *  ids in this list. Default DEFAULT_METRICS. */
  readonly metrics?: readonly MetricDefinition[];
};

type NavIdOptions = {
  readonly includeTenantOverview?: boolean;
  readonly includeTierAdmin?: boolean;
  readonly includeCapOverview: boolean;
  readonly includeDocumentDesigner: boolean;
};

function tenantWorkspaceNavIds(options: NavIdOptions): string[] {
  return [
    ...(options.includeTenantOverview === true ? ["admin-shell:nav:tenant-overview"] : []),
    "tenant:nav:members",
    "audit:nav:audit-log",
    ...(options.includeCapOverview ? ["admin-shell:nav:my-caps"] : []),
    ...(options.includeDocumentDesigner ? ["document-designer:nav:templates"] : []),
  ];
}

function platformWorkspaceNavIds(options: NavIdOptions): string[] {
  return [
    "admin-shell:nav:platform-overview",
    "admin-shell:nav:tenants",
    ...(options.includeCapOverview ? ["admin-shell:nav:tenant-caps"] : []),
    "audit:nav:audit-log-all-tenants",
    "jobs:nav:job-runs",
    ...(options.includeDocumentDesigner ? ["document-designer:nav:platform-templates"] : []),
    ...(options.includeTierAdmin === true ? ["admin-shell:nav:tier-admin"] : []),
  ];
}

export function createAdminShellFeature(options: CreateAdminShellOptions = {}): FeatureDefinition {
  const tenantWsId = options.workspaceIds?.tenant ?? DEFAULT_TENANT_WORKSPACE_ID;
  const platformWsId = options.workspaceIds?.platform ?? DEFAULT_PLATFORM_WORKSPACE_ID;
  const includeTierAdmin = options.includeTierAdmin ?? true;
  const includeCapOverview = options.includeCapOverview ?? false;
  const includeDocumentDesigner = options.includeDocumentDesigner ?? false;
  const includeTenantOverview = options.includeTenantOverview ?? true;
  const registerWorkspaces = options.registerWorkspaces ?? true;
  const metrics = options.metrics ?? DEFAULT_METRICS;

  return defineFeature(ADMIN_SHELL_FEATURE, (r) => {
    r.describe(
      "Registers tenant-admin and platform-admin workspaces with provider nav into owner-feature screens (`tenant:screen:members`, `audit:screen:audit-log`, `audit:screen:audit-log-all-tenants`, `tenant:screen:tenant-list`, `jobs:screen:job-runs`, optional `tier-engine:screen:tier-admin`, optional `cap-overview:screen:my-caps`/`cap-overview:screen:tenant-cap-list`, optional `document-designer` template navs) and the two overview dashboards (the tenant one can be dropped with `includeTenantOverview: false`), built from the metrics list (`metrics` option, default DEFAULT_METRICS). Mount after user, tenant, audit, jobs, metrics and metrics-system; pass `workspaceIds` to match app URL conventions (e.g. Studio `d`/`s`, PublicStatus `admin`/`sysadmin`). Client: `adminShellClient()`, `tenantClient()`, `auditClient()`, `jobsClient()`, optional `tierEngineClient()`.",
    );
    r.uiHints({
      displayLabel: "Admin Shell",
      category: "operations",
      recommended: false,
    });
    r.requires({ features: ["user"] });
    r.requires({ features: ["tenant"] });
    r.requires({ features: ["audit"] });
    r.requires({ features: ["jobs"] });
    r.requires({ features: ["metrics"] });
    r.requires({ features: ["metrics-system"] });
    if (includeTierAdmin) r.requires({ features: ["tier-engine"] });
    if (includeCapOverview) r.requires({ features: ["cap-overview"] });
    if (includeDocumentDesigner) r.requires({ features: ["document-designer"] });

    r.translations({ keys: ADMIN_SHELL_I18N });

    const tenantNav = tenantWorkspaceNavIds({
      includeTenantOverview,
      includeCapOverview,
      includeDocumentDesigner,
    });
    const platformNav = platformWorkspaceNavIds({
      includeTierAdmin,
      includeCapOverview,
      includeDocumentDesigner,
    });

    if (includeTenantOverview) {
      r.screen({
        id: TENANT_OVERVIEW_SCREEN_ID,
        type: "dashboard",
        access: { roles: access.admin },
        description: "admin-shell.screen.tenant-overview.subtitle",
        timeRange: OVERVIEW_TIME_RANGE,
        panels: [...tenantOverviewPanels(metrics, { includeCapOverview })],
      });
      r.nav({
        id: "tenant-overview",
        label: "admin-shell:nav.tenantOverview",
        icon: "home",
        screen: "admin-shell:screen:tenant-overview",
        order: 1,
      });
    }

    r.screen({
      id: PLATFORM_OVERVIEW_SCREEN_ID,
      type: "dashboard",
      access: { roles: access.systemAdmin },
      description: "admin-shell.screen.platform-overview.subtitle",
      scope: PLATFORM_SCOPE,
      timeRange: OVERVIEW_TIME_RANGE,
      // The picker needs a SystemAdmin {rows:{value,label}} tenant query; only cap-overview ships one.
      ...(includeCapOverview && { filter: PLATFORM_TENANT_FILTER }),
      panels: [...platformOverviewPanels(metrics)],
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
