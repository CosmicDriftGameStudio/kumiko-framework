import { describe, expect, test } from "bun:test";
import { JobQueries } from "../../jobs/constants";
import { TenantQueries } from "../../tenant/constants";
import { UserQueries } from "../../user/constants";
import { PLATFORM_OVERVIEW_SCREEN_ID, TENANT_OVERVIEW_SCREEN_ID } from "../constants";
import { createAdminShellFeature } from "../feature";
import {
  isOverviewQueryAllowed,
  PLATFORM_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_ALLOWED_QUERIES,
  TENANT_OVERVIEW_FORBIDDEN_QUERIES,
} from "../overview-allowlist";

// Every screen dispatches only the queries baked into its own panel
// definitions (no client-side allowlist gate anymore, fw#2312) — the
// allowlist's regression value now lives in this static cross-check instead
// of a runtime guard.
function statPanelQueries(screenId: string): readonly string[] {
  const screen = createAdminShellFeature().screens[screenId];
  if (screen?.type !== "dashboard") throw new Error(`expected dashboard screen: ${screenId}`);
  return screen.panels.map((panel) => {
    if (panel.kind !== "stat") throw new Error(`expected stat panel on ${screenId}: ${panel.kind}`);
    return panel.query;
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

  test("platform allowlist is tenant:list + jobs:list + user:list", () => {
    expect(PLATFORM_OVERVIEW_ALLOWED_QUERIES).toEqual([
      TenantQueries.list,
      JobQueries.list,
      UserQueries.list,
    ]);
  });

  test("platform overview allows the user-count query (fw#891 regression)", () => {
    expect(isOverviewQueryAllowed("platform", UserQueries.list)).toBe(true);
  });

  test("platform queries are not tenant-allowlisted", () => {
    expect(isOverviewQueryAllowed("tenant", TenantQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", JobQueries.list)).toBe(false);
    expect(isOverviewQueryAllowed("tenant", UserQueries.list)).toBe(false);
  });
});

describe("overview screen panels vs allowlist (fw#2312 regression)", () => {
  test("tenant-overview panels use only allowlisted, never forbidden, queries", () => {
    for (const query of statPanelQueries(TENANT_OVERVIEW_SCREEN_ID)) {
      expect(isOverviewQueryAllowed("tenant", query)).toBe(true);
      expect((TENANT_OVERVIEW_FORBIDDEN_QUERIES as readonly string[]).includes(query)).toBe(false);
    }
  });

  test("platform-overview panels use only allowlisted queries", () => {
    for (const query of statPanelQueries(PLATFORM_OVERVIEW_SCREEN_ID)) {
      expect(isOverviewQueryAllowed("platform", query)).toBe(true);
    }
  });
});
