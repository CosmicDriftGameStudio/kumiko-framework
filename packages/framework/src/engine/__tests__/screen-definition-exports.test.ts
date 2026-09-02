import { describe, expect, test } from "bun:test";
import type {
  CustomScreenDefinition,
  DashboardScreenDefinition,
  DashboardStatPanel,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowFieldExtractor,
  ScreenNavSugar,
  UnitKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { requiredKeysFromScreen, screenTitleKey } from "../../i18n/required-surface-keys";

// fw#2519: the engine barrel exported ScreenDefinition (the union) but not
// its individual members — apps splitting screens out of feature.ts into
// their own module (kumiko-guard-ui's 300-line limit) could only type the
// union, losing per-kind checking. Every type imported below comes from the
// public "@cosmicdrift/kumiko-framework/engine" subpath, not an internal
// ../types path — an internal import would pass before the fix too, since
// the internal barrel already had these.
//
// The import above is `import type`, erased at runtime — this file guards
// the barrel at compile time only (tsc, via `check-wt.sh`/CI), not via
// `bun test`. If a type export regresses, `tsc --build` fails; this suite
// still passes green.
describe("engine barrel exports the per-screen definition types", () => {
  test("ProjectionListScreenDefinition is assignable and feeds requiredKeysFromScreen", () => {
    const screen: ProjectionListScreenDefinition = {
      id: "recent-jobs",
      type: "projectionList",
      query: "jobs:query:recent",
      columns: [{ field: "status", label: "publicstatus:column.status" }],
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain(screenTitleKey("recent-jobs"));
    expect(keys).toContain("publicstatus:column.status");
  });

  test("ProjectionDetailScreenDefinition is assignable and feeds requiredKeysFromScreen", () => {
    const screen: ProjectionDetailScreenDefinition = {
      id: "job-detail",
      type: "projectionDetail",
      query: "jobs:query:detail",
      layout: {
        sections: [{ title: "publicstatus:section.job", fields: ["runId"] }],
      },
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:section.job");
    expect(keys).toContain("publicstatus:entity:__projection-detail__:field:runId");
  });

  test("DashboardScreenDefinition + DashboardStatPanel are assignable and feed requiredKeysFromScreen", () => {
    const panel: DashboardStatPanel = {
      kind: "stat",
      id: "open-incidents",
      label: "publicstatus:panel.openIncidents",
      query: "publicstatus:query:incidents:openCount",
      valueField: "count",
    };
    const screen: DashboardScreenDefinition = {
      id: "ops-dashboard",
      type: "dashboard",
      panels: [panel],
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain("publicstatus:panel.openIncidents");
  });

  test("CustomScreenDefinition standalone carries nav/detailFor directly", () => {
    const nav: ScreenNavSugar = { label: "publicstatus:nav.componentDetail", order: 1 };
    const screen: CustomScreenDefinition = {
      id: "component-detail",
      type: "custom",
      renderer: { react: {} },
      nav,
      detailFor: "component",
    };
    expect(screen.nav?.label).toBe("publicstatus:nav.componentDetail");
    expect(screen.detailFor).toBe("component");
  });

  test("ProjectionListScreenDefinition also carries nav/detailFor directly, not just via ScreenDefinition", () => {
    const screen: ProjectionListScreenDefinition = {
      id: "job-list",
      type: "projectionList",
      query: "jobs:query:list",
      columns: ["status"],
      nav: { label: "publicstatus:nav.jobList" },
      detailFor: "job",
    };
    expect(screen.nav?.label).toBe("publicstatus:nav.jobList");
    expect(screen.detailFor).toBe("job");
  });

  test("UnitKey / RowFieldExtractor are exported and usable standalone", () => {
    const unit: UnitKey = "km";
    const extractor: RowFieldExtractor = { pick: ["id", "version"] };
    expect(unit).toBe("km");
    expect(extractor).toEqual({ pick: ["id", "version"] });
  });
});
