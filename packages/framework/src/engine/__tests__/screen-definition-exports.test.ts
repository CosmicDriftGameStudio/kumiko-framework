import { describe, expect, test } from "bun:test";
import type {
  ActionFormScreenDefinition,
  ConfigEditScreenDefinition,
  CustomScreenDefinition,
  DashboardScreenDefinition,
  DashboardStatPanel,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
  ProjectionDetailScreenDefinition,
  ProjectionListScreenDefinition,
  RowFieldExtractor,
  ScreenNavSugar,
  UnitKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { requiredKeysFromScreen, screenTitleKey } from "../../i18n/required-surface-keys.js";

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
// `bun test`. If a type export regresses, `tsc --build` fails; the runtime
// assertions only cover requiredKeysFromScreen on the typed literals.
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
    expect(requiredKeysFromScreen("publicstatus", screen)).toEqual([
      screenTitleKey("component-detail"),
    ]);
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
    expect(requiredKeysFromScreen("publicstatus", screen)).toContain(screenTitleKey("job-list"));
  });

  test("EntityListScreenDefinition carries nav/detailFor directly", () => {
    const screen: EntityListScreenDefinition = {
      id: "incident-list",
      type: "entityList",
      entity: "incident",
      columns: ["title"],
      nav: { label: "publicstatus:nav.incidentList" },
      detailFor: "incident",
    };
    const keys = requiredKeysFromScreen("publicstatus", screen);
    expect(keys).toContain(screenTitleKey("incident-list"));
    expect(keys).toContain("publicstatus:entity:incident:field:title");
  });

  test("EntityEditScreenDefinition carries nav/detailFor directly", () => {
    const screen: EntityEditScreenDefinition = {
      id: "incident-edit",
      type: "entityEdit",
      entity: "incident",
      layout: { sections: [{ fields: ["title"] }] },
      nav: { label: "publicstatus:nav.incidentEdit" },
      detailFor: "incident",
    };
    expect(requiredKeysFromScreen("publicstatus", screen)).toContain(
      screenTitleKey("incident-edit"),
    );
  });

  test("ActionFormScreenDefinition carries nav/detailFor directly", () => {
    const screen: ActionFormScreenDefinition = {
      id: "post-update",
      type: "actionForm",
      handler: "publicstatus:write:incident:postUpdate",
      fields: { message: { type: "text" } },
      layout: { sections: [{ fields: ["message"] }] },
      nav: { label: "publicstatus:nav.postUpdate" },
      detailFor: "incident",
    };
    expect(requiredKeysFromScreen("publicstatus", screen)).toContain(screenTitleKey("post-update"));
  });

  test("ConfigEditScreenDefinition carries nav/detailFor directly", () => {
    const screen: ConfigEditScreenDefinition = {
      id: "status-settings",
      type: "configEdit",
      scope: "tenant",
      configKeys: { title: "publicstatus:config:title" },
      fields: { title: { type: "text" } },
      layout: { sections: [{ fields: ["title"] }] },
      nav: { label: "publicstatus:nav.settings" },
      detailFor: "status",
    };
    expect(requiredKeysFromScreen("publicstatus", screen)).toContain(
      screenTitleKey("status-settings"),
    );
  });
});

// Compile-time only: tsc fails if either export leaves the public barrel.
const unitKeyGuard: UnitKey = "km";
const rowFieldExtractorGuard = { pick: ["id", "version"] } satisfies RowFieldExtractor;
void unitKeyGuard;
void rowFieldExtractorGuard;
