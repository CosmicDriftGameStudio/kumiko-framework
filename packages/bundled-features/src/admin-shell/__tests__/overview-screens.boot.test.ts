import { describe, expect, test } from "bun:test";
import { access } from "@cosmicdrift/kumiko-framework/engine";
import type { DashboardPanelDefinition } from "@cosmicdrift/kumiko-framework/ui-types";
import { CapOverviewQueries } from "../../cap-overview/constants.js";
import { JobQueries } from "../../jobs/constants.js";
import {
  activeTenantsMetric,
  auditWritesMetric,
  DEFAULT_METRICS,
  metricQueryName,
} from "../../metrics/index.js";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../constants.js";
import { createAdminShellFeature } from "../feature.js";

function dashboard(shell: ReturnType<typeof createAdminShellFeature>, screenId: string) {
  const screen = shell.screens[screenId];
  if (screen?.type !== "dashboard") throw new Error(`expected dashboard screen: ${screenId}`);
  return screen;
}

function panelIds(panels: readonly DashboardPanelDefinition[]): readonly string[] {
  return panels.flatMap((panel) =>
    panel.kind === "stat-group" ? panel.stats.map((stat) => stat.id) : [panel.id],
  );
}

function panelQueries(panels: readonly DashboardPanelDefinition[]): readonly string[] {
  return panels.flatMap((panel) => {
    if (panel.kind === "stat-group") return panel.stats.map((stat) => stat.query);
    return "query" in panel ? [panel.query] : [];
  });
}

const full = createAdminShellFeature({ metrics: DEFAULT_METRICS, includeCapOverview: true });

describe("platform-overview", () => {
  const screen = dashboard(full, PLATFORM_OVERVIEW_SCREEN_ID);

  test("is SystemAdmin-only with all-tenants scope, time range and tenant picker", () => {
    expect(screen.access).toEqual({ roles: access.systemAdmin });
    expect(screen.scope?.badge).toBe("admin-shell:overview.scope.badge");
    expect(screen.timeRange?.id).toBe("range");
    expect(screen.timeRange?.default).toBe("7d");
    expect(screen.timeRange?.options.map((option) => option.value)).toEqual(["24h", "7d", "30d"]);
    expect(screen.filter?.id).toBe("tenantId");
    expect(screen.filter?.optionsQuery).toBe(CapOverviewQueries.tenantOptions);
  });

  test("KPI strip, charts and failure list read the system metrics", () => {
    expect(panelIds(screen.panels)).toEqual([
      "kpi-active-tenants",
      "kpi-active-users",
      "kpi-failed-job-runs",
      "kpi-failed-deliveries",
      "job-runs-by-status",
      "deliveries-by-channel",
      "recent-failures",
    ]);
    expect(panelQueries(screen.panels)).toEqual([
      metricQueryName("system", "active-tenants"),
      metricQueryName("system", "active-users"),
      metricQueryName("system", "failed-job-runs"),
      metricQueryName("system", "failed-deliveries"),
      metricQueryName("system", "job-runs-by-status"),
      metricQueryName("system", "deliveries-by-channel"),
      JobQueries.list,
    ]);
  });

  test("sources without a tenant column ignore the tenant picker", () => {
    const flat = screen.panels.flatMap((panel): readonly DashboardPanelDefinition[] =>
      panel.kind === "stat-group" ? panel.stats : [panel],
    );
    const ignoring = flat
      .filter((panel) => "ignoreScreenFilter" in panel && panel.ignoreScreenFilter === true)
      .map((panel) => panel.id);
    expect(ignoring).toEqual([
      "kpi-active-tenants",
      "kpi-failed-job-runs",
      "job-runs-by-status",
      "recent-failures",
    ]);
  });

  test("has no tenant picker without cap-overview", () => {
    const shell = createAdminShellFeature({ metrics: DEFAULT_METRICS });
    expect(dashboard(shell, PLATFORM_OVERVIEW_SCREEN_ID).filter).toBeUndefined();
  });
});

describe("tenant-overview", () => {
  test("is access.admin, reads tenant metrics, has no platform-only queries", () => {
    const screen = dashboard(full, TENANT_OVERVIEW_SCREEN_ID);
    expect(screen.access).toEqual({ roles: access.admin });
    expect(screen.timeRange?.id).toBe("range");
    expect(screen.scope).toBeUndefined();
    const queries = panelQueries(screen.panels);
    expect(queries).toContain(metricQueryName("tenant", "audit-writes"));
    expect(queries).toContain(JobQueries.failures);
    expect(queries).toContain(CapOverviewQueries.capsUsage);
    expect(queries).not.toContain(metricQueryName("system", "job-runs-by-status"));
    expect(queries).not.toContain(metricQueryName("tenant", "job-runs-by-status"));
    expect(queries).not.toContain(JobQueries.list);
  });
});

describe("panel layout", () => {
  test("charts and lists sit side by side in half-width pairs", () => {
    const spans = (id: string) =>
      dashboard(full, id).panels.flatMap((panel) =>
        "span" in panel && panel.span !== undefined ? [`${panel.id}:${panel.span}`] : [],
      );
    expect(spans(PLATFORM_OVERVIEW_SCREEN_ID)).toEqual([
      "job-runs-by-status:half",
      "deliveries-by-channel:half",
      "recent-failures:full",
    ]);
    expect(spans(TENANT_OVERVIEW_SCREEN_ID)).toEqual([
      "deliveries-by-channel:half",
      "quotas:half",
      "audit-writes:half",
      "recent-failures:half",
    ]);
  });
});

describe("metrics option", () => {
  test("panels exist only for metric ids in the list", () => {
    const shell = createAdminShellFeature({ metrics: [activeTenantsMetric, auditWritesMetric] });
    expect(panelIds(dashboard(shell, PLATFORM_OVERVIEW_SCREEN_ID).panels)).toEqual([
      "kpi-active-tenants",
      "recent-failures",
    ]);
    expect(panelIds(dashboard(shell, TENANT_OVERVIEW_SCREEN_ID).panels)).toEqual([
      "audit-writes",
      "recent-failures",
    ]);
  });
});
