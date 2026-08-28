import { describe, expect, test } from "bun:test";
import { validateBoot } from "@cosmicdrift/kumiko-framework/engine";
import { billingFoundationFeature } from "../../billing-foundation";
import { createComplianceProfilesFeature } from "../../compliance-profiles";
import { createConfigFeature } from "../../config/feature";
import { createTenantFeature } from "../../tenant";
import { createTenantLifecycleFeature } from "../../tenant-lifecycle";
import { tierEngineFeature } from "../../tier-engine";
import {
  MY_CAPS_SCREEN_ID,
  PLATFORM_TENANT_CAPS_SCREEN_ID,
  TENANT_CAP_LIST_SCREEN_ID,
} from "../constants";
import { createCapOverviewFeature } from "../feature";
import type { CapSpec } from "../types";

const testCap: CapSpec = {
  id: "widgets",
  label: "test.cap.widgets",
  limit: () => 5,
  usage: async () => 0,
};

describe("cap-overview boot", () => {
  test("boots cleanly with a minimal cap set", () => {
    const features = [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      tierEngineFeature,
      billingFoundationFeature,
      createCapOverviewFeature({ caps: [testCap] }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("boots cleanly with the tier facet enabled (facets + filters schema wiring)", () => {
    const features = [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      tierEngineFeature,
      billingFoundationFeature,
      createCapOverviewFeature({ caps: [testCap], tiers: ["free", "pro"] }),
    ];
    expect(() => validateBoot(features)).not.toThrow();
  });

  test("registers all three queries and three screens", () => {
    const feature = createCapOverviewFeature({ caps: [testCap] });
    expect(feature.queryHandlers["tenant-caps:list"]).toBeDefined();
    expect(feature.queryHandlers["caps:usage"]).toBeDefined();
    expect(feature.queryHandlers["tenant-options"]).toBeDefined();
    expect(feature.screens[TENANT_CAP_LIST_SCREEN_ID]?.type).toBe("projectionList");
    expect(feature.screens[MY_CAPS_SCREEN_ID]?.type).toBe("dashboard");
    expect(feature.screens[PLATFORM_TENANT_CAPS_SCREEN_ID]?.type).toBe("dashboard");
  });

  test("tenant-cap-list facet field is a declared column and the list handler schema accepts filters", () => {
    const feature = createCapOverviewFeature({ caps: [testCap], tiers: ["free", "pro"] });
    const screen = feature.screens[TENANT_CAP_LIST_SCREEN_ID];
    if (screen?.type !== "projectionList") throw new Error("expected projectionList screen");
    const facetField = screen.facets?.[0]?.field;
    const columnFields = screen.columns.map((column) =>
      typeof column === "string" ? column : column.field,
    );
    expect(facetField).toBe("tier");
    expect(columnFields).toContain("tier");
    expect(columnFields).toContain(`cap_${testCap.id}`);
  });

  test("no tier facet when `tiers` is omitted", () => {
    const feature = createCapOverviewFeature({ caps: [testCap] });
    const screen = feature.screens[TENANT_CAP_LIST_SCREEN_ID];
    if (screen?.type !== "projectionList") throw new Error("expected projectionList screen");
    expect(screen.facets ?? []).toHaveLength(0);
  });

  // Deep-link: clicking a row on tenant-cap-list must land on THAT tenant's
  // dashboard, not an empty one — the boot validator now lets a navigate
  // rowAction's params through onto a dashboard target when its extractor
  // produces the target's own `filter.id` (framework#1708 follow-up).
  test("row-click deep-links into platform-tenant-caps with a params extractor matching its filter id", () => {
    const features = [
      createConfigFeature(),
      createTenantFeature(),
      createComplianceProfilesFeature(),
      createTenantLifecycleFeature(),
      tierEngineFeature,
      billingFoundationFeature,
      createCapOverviewFeature({ caps: [testCap] }),
    ];
    expect(() => validateBoot(features)).not.toThrow();

    const feature = createCapOverviewFeature({ caps: [testCap] });
    const listScreen = feature.screens[TENANT_CAP_LIST_SCREEN_ID];
    if (listScreen?.type !== "projectionList") throw new Error("expected projectionList screen");
    const rowAction = listScreen.rowActions?.[0];
    if (rowAction?.kind !== "navigate") throw new Error("expected a navigate rowAction");
    expect(rowAction.rowClick).toBe(true);
    expect(rowAction.screen).toBe(PLATFORM_TENANT_CAPS_SCREEN_ID);
    expect(rowAction.params).toEqual({ map: { tenantId: "tenantId" } });

    const dashboardScreen = feature.screens[PLATFORM_TENANT_CAPS_SCREEN_ID];
    if (dashboardScreen?.type !== "dashboard") throw new Error("expected dashboard screen");
    expect(dashboardScreen.filter?.id).toBe("tenantId");
  });

  test("throws at construction when listCaps references an unknown cap id", () => {
    expect(() =>
      createCapOverviewFeature({ caps: [testCap], listCaps: ["does-not-exist"] }),
    ).toThrow(/unknown cap id "does-not-exist"/);
  });

  test("throws when caps is empty", () => {
    expect(() => createCapOverviewFeature({ caps: [] })).toThrow(/must not be empty/);
  });
});
