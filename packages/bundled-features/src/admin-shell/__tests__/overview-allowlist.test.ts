import { describe, expect, test } from "bun:test";
import { CapOverviewQueries } from "../../cap-overview/constants.js";
import { JobQueries } from "../../jobs/constants.js";
import { DEFAULT_METRICS, metricQueryName } from "../../metrics/index.js";
import { TenantQueries } from "../../tenant/constants.js";
import { UserQueries } from "../../user/constants.js";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../constants.js";
import { createAdminShellFeature } from "../feature.js";
import {
  isOverviewQueryAllowed,
  PLATFORM_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist.js";

// Every screen dispatches only the queries baked into its own panel
// definitions (no client-side allowlist gate anymore, fw#2312) — the
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

  test("tenant allowlist includes members, invitations, readiness", () => {
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain(TenantQueries.members);
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain(TenantQueries.invitations);
    expect(TENANT_OVERVIEW_ALLOWED_QUERIES).toContain("config:query:readiness");
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

describe("overview screen panels vs allowlist (fw#2312 regression)", () => {
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
