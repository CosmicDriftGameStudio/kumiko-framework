import { describe, expect, test } from "bun:test";
import { CapOverviewQueries } from "../../cap-overview/web/constants.ts";
import { JobQueries } from "../../jobs/web/constants.ts";
import { DEFAULT_METRICS, metricQueryName } from "../../metrics/index.ts";
import { TenantQueries } from "../../tenant/web/constants.ts";
import { UserQueries } from "../../user/web/constants.ts";
import { createAdminShellFeature } from "../feature.ts";
import {
  isOverviewQueryAllowed,
  PLATFORM_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist.ts";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../web/constants.ts";

// Every screen dispatches only the queries baked into its own panel
// definitions (no client-side allowlist gate anymore) — the
// allowlist's regression value now lives in this static cross-check instead
// of a runtime guard.
function panelQueries(screenId: string): readonly string[] {
  const screen = createAdminShellFeature({
    metrics: DEFAULT_METRICS,
    includeCapOverview: true,
  }).screens[screenId];
  if (screen?.type !== "dashboard") throw new Error(`expected dashboard screen: ${screenId}`);
  return screen.panels.flatMap((panel) => {
    if (panel.kind === "stat-group") return panel.stats.map((stat) => stat.query);
    return "query" in panel ? [panel.query] : [];
  });
}

describe("overview query allowlist", () => {
  test("tenant allowlist excludes platform-only queries", () => {
    for (const forbidden of TENANT_OVERVIEW_FORBIDDEN_QUERIES) {
      expect(isOverviewQueryAllowed("tenant", forbidden)).toBe(false);
      expect(TENANT_OVERVIEW_ALLOWED_QUERIES).not.toContain(forbidden);
    }
  });

  test("tenant allowlist is the failures list + the caps-usage query", () => {
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toEqual([
      JobQueries.failures,
      CapOverviewQueries.capsUsage,
    ]);
  });

  test("platform allowlist is jobs:list + the tenant-options picker query", () => {
    expect(PLATFORM_OVERVIEW_ALLOWED_QUERIES).toEqual([
      JobQueries.list,
      CapOverviewQueries.tenantOptions,
    ]);
  });

  test("metrics queries are allowed only for their own scope", () => {
    expect(isOverviewQueryAllowed("tenant", metricQueryName("tenant", "audit-writes"))).toBe(true);
    expect(isOverviewQueryAllowed("tenant", metricQueryName("system", "audit-writes"))).toBe(false);
    expect(isOverviewQueryAllowed("platform", metricQueryName("system", "audit-writes"))).toBe(
      true,
    );
    expect(isOverviewQueryAllowed("platform", metricQueryName("tenant", "audit-writes"))).toBe(
      false,
    );
  });

  test("platform queries are not tenant-allowlisted", () => {
    expect(isOverviewQueryAllowed("tenant", TenantQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", JobQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", UserQueries.list)).toBe(false);
  });
});

describe("overview screen panels use only allowlisted, never forbidden, queries", () => {
  test("tenant-overview panels use only allowlisted, never forbidden, queries", () => {
    for (const query of panelQueries(TENANT_OVERVIEW_SCREEN_ID)) {
      expect(isOverviewQueryAllowed("tenant", query)).toBe(true);
      expect((TENANT_OVERVIEW_FORBIDDEN_QUERIES as readonly string[]).includes(query)).toBe(false);
    }
  });

  test("platform-overview panels use only allowlisted queries", () => {
    for (const query of panelQueries(PLATFORM_OVERVIEW_SCREEN_ID)) {
      expect(isOverviewQueryAllowed("platform", query)).toBe(true);
    }
  });
});
