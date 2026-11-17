// admin-shell — role-gated workspaces + provider nav for tenant vs platform operators.
// Screens live in owner features (tenant, audit, jobs, …); this feature only
// composes workspaces and cross-feature nav entries.

import {
  access,
  defineFeature,
  type FeatureDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { DashboardPanelDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
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
  /** Tenant overview dashboard: screen, nav and the entry in the tenant workspace. Default true.
   *  Set false when the app ships its own landing screen for tenant admins. */
  readonly includeTenantOverview?: boolean;
  /** When false, only overview screens + nav are registered — app owns r.workspace(). Default true. */
  readonly registerWorkspaces?: boolean;
  /** Metric list the overview panels are built from — pass the SAME list to
   *  createMetricsFeature / createSystemMetricsFeature. Panels exist only for
   *  ids in this list. Default DEFAULT_METRICS. */
  readonly metrics?: readonly MetricDefinition[];
  /** Panels appended to the platform overview, for tiles a mounted feature owns (e.g. the helpdesk inbox count). */
  readonly extraPlatformPanels?: readonly DashboardPanelDefinition[];
};

export function createAdminShellFeature(options: CreateAdminShellOptions = {}): FeatureDefinition {
  const tenantWsId = options.workspaceIds?.tenant ?? DEFAULT_TENANT_WORKSPACE_ID;
  const platformWsId = options.workspaceIds?.platform ?? DEFAULT_PLATFORM_WORKSPACE_ID;
  const includeTierAdmin = options.includeTierAdmin ?? true;
  const includeCapOverview = options.includeCapOverview ?? false;
  const includeTenantOverview = options.includeTenantOverview ?? true;
  const registerWorkspaces = options.registerWorkspaces ?? true;
  const metrics = options.metrics ?? DEFAULT_METRICS;

  return defineFeature(ADMIN_SHELL_FEATURE, (r) => {
    r.describe(
      'Registers tenant-admin and platform-admin workspaces that collect every nav with adminArea "tenant" / "platform" of the mounted features (members, audit, jobs, event consumers, export jobs, feature toggles, caps, document templates, users, optional tier-admin/caps) and the two overview dashboards (the tenant one can be dropped with `includeTenantOverview: false`), built from the metrics list (`metrics` option, default DEFAULT_METRICS). Apps with their own workspaces set `registerWorkspaces: false` and `collectAdminArea` on them. Mount after user, tenant, audit, jobs, metrics and metrics-system; pass `workspaceIds` to match app URL conventions (e.g. Studio `d`/`s`, PublicStatus `admin`/`sysadmin`). Client: `adminShellClient()`, `tenantClient()`, `auditClient()`, `jobsClient()`, optional `tierEngineClient()`.',
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

    r.translations({ keys: ADMIN_SHELL_I18N });

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
        adminArea: "tenant",
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
      panels: [...platformOverviewPanels(metrics), ...(options.extraPlatformPanels ?? [])],
    });
    r.nav({
      id: "platform-overview",
      label: "admin-shell:nav.platformOverview",
      icon: "dashboard",
      screen: "admin-shell:screen:platform-overview",
      order: 1,
      adminArea: "platform",
    });

    r.nav({
      id: "tenants",
      label: "admin-shell:nav.tenants",
      icon: "building",
      screen: "tenant:screen:tenant-list",
      access: { roles: access.systemAdmin },
      order: 10,
      adminArea: "platform",
    });

    r.nav({
      id: "users",
      label: "admin-shell:nav.users",
      icon: "users",
      screen: "user:screen:user-list",
      access: { roles: access.systemAdmin },
      order: 20,
      adminArea: "platform",
    });

    if (includeTierAdmin) {
      r.nav({
        id: "tier-admin",
        label: "admin-shell:nav.tierAdmin",
        icon: "shield",
        screen: "tier-engine:screen:tier-admin",
        access: { roles: access.systemAdmin },
        order: 30,
        adminArea: "platform",
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
        adminArea: "tenant",
      });
      r.nav({
        id: "tenant-caps",
        label: "admin-shell:nav.tenantCaps",
        icon: "gauge",
        screen: "cap-overview:screen:tenant-cap-list",
        access: { roles: access.systemAdmin },
        order: 20,
        adminArea: "platform",
      });
    }

    if (registerWorkspaces) {
      r.workspace({
        id: tenantWsId,
        label: "admin-shell:workspace.tenant",
        icon: "users",
        order: 1,
        access: { roles: access.admin },
        collectAdminArea: "tenant",
        default: true,
      });

      r.workspace({
        id: platformWsId,
        label: "admin-shell:workspace.platform",
        icon: "shield",
        order: 2,
        access: { roles: access.systemAdmin },
        collectAdminArea: "platform",
      });
    }
  });
}
