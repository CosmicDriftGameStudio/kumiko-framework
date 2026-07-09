import { describe, expect, test } from "bun:test";
import { requiredKeysFromScreen } from "../../i18n/required-surface-keys";
import { validateBoot } from "../boot-validator";
import { defineFeature } from "../define-feature";
import type { DashboardScreenDefinition } from "../types/screen";

const STAT_PANEL = {
  kind: "stat",
  id: "open-incidents",
  label: "demo:dashboard:panel:open-incidents",
  query: "demo:query:incident:open-count",
  valueField: "count",
} as const;

function dashboardFeature(
  panels: DashboardScreenDefinition["panels"],
  filter?: DashboardScreenDefinition["filter"],
) {
  return defineFeature("demo", (r) => {
    r.screen({
      id: "overview",
      type: "dashboard",
      panels,
      ...(filter !== undefined && { filter }),
    });
    r.translations({
      keys: {
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
        "demo:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
        "demo:dashboard:col:name": { de: "Name", en: "Name" },
        "demo:dashboard:group:net-worth": { de: "Net Worth", en: "Net Worth" },
        "demo:dashboard:filter:region": { de: "Region", en: "Region" },
      },
    });
  });
}

describe("validateBoot — dashboard screens", () => {
  test("accepts a valid stat + list panel set", () => {
    const feature = dashboardFeature([
      STAT_PANEL,
      {
        kind: "list",
        id: "latest",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        columns: [{ field: "name", label: "demo:dashboard:col:name" }],
      },
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects an empty panels list", () => {
    const feature = dashboardFeature([]);
    expect(() => validateBoot([feature])).toThrow(/empty panels list/);
  });

  test("rejects duplicate panel ids", () => {
    const feature = dashboardFeature([STAT_PANEL, STAT_PANEL]);
    expect(() => validateBoot([feature])).toThrow(/duplicate panel id/);
  });

  test("rejects a stat panel with empty valueField", () => {
    const feature = dashboardFeature([{ ...STAT_PANEL, valueField: "" }]);
    expect(() => validateBoot([feature])).toThrow(/empty valueField/);
  });

  test("rejects a list panel without columns", () => {
    const feature = dashboardFeature([
      {
        kind: "list",
        id: "latest",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        columns: [],
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/empty columns list/);
  });

  test("requiredKeysFromScreen sammelt Panel- und Column-Labels", () => {
    const screen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      panels: [
        STAT_PANEL,
        {
          kind: "list",
          id: "latest",
          label: "demo:dashboard:panel:latest",
          query: "demo:query:incident:latest",
          columns: [{ field: "name", label: "demo:dashboard:col:name" }],
        },
      ],
    };
    const keys = requiredKeysFromScreen("demo", screen);
    expect(keys).toContain("screen:overview.title");
    expect(keys).toContain("demo:dashboard:panel:open-incidents");
    expect(keys).toContain("demo:dashboard:panel:latest");
    expect(keys).toContain("demo:dashboard:col:name");
  });

  test("accepts a stat-group, feed, progress-list and custom panel", () => {
    const feature = dashboardFeature(
      [
        {
          kind: "stat-group",
          id: "net-worth",
          label: "demo:dashboard:group:net-worth",
          stats: [STAT_PANEL],
        },
        {
          kind: "feed",
          id: "upcoming",
          label: "demo:dashboard:panel:latest",
          query: "demo:query:incident:latest",
        },
        {
          kind: "progress-list",
          id: "progress",
          label: "demo:dashboard:panel:latest",
          query: "demo:query:incident:latest",
        },
        {
          kind: "custom",
          id: "custom-panel",
          component: { react: { __component: "demo-custom" } },
        },
      ],
      {
        id: "region",
        label: "demo:dashboard:filter:region",
        kind: "select",
        options: [{ value: "eu", label: "demo:dashboard:filter:region" }],
      },
    );
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects a stat-group with an empty stats list", () => {
    const feature = dashboardFeature([
      { kind: "stat-group", id: "net-worth", label: "demo:dashboard:group:net-worth", stats: [] },
    ]);
    expect(() => validateBoot([feature])).toThrow(/empty stats list/);
  });

  test("rejects a duplicate id nested inside a stat-group", () => {
    const feature = dashboardFeature([
      STAT_PANEL,
      {
        kind: "stat-group",
        id: "net-worth",
        label: "demo:dashboard:group:net-worth",
        stats: [STAT_PANEL],
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/duplicate panel id/);
  });

  test("rejects a custom panel without a react/native component", () => {
    const feature = dashboardFeature([{ kind: "custom", id: "custom-panel", component: {} }]);
    expect(() => validateBoot([feature])).toThrow(/has no component/);
  });

  test("rejects a filter that sets neither options nor optionsQuery", () => {
    const feature = dashboardFeature([STAT_PANEL], {
      id: "region",
      label: "demo:dashboard:filter:region",
      kind: "select",
    });
    expect(() => validateBoot([feature])).toThrow(/exactly one of/);
  });

  test("rejects a filter that sets both options and optionsQuery", () => {
    const feature = dashboardFeature([STAT_PANEL], {
      id: "region",
      label: "demo:dashboard:filter:region",
      kind: "select",
      options: [{ value: "eu", label: "demo:dashboard:filter:region" }],
      optionsQuery: "demo:query:folder:list",
    });
    expect(() => validateBoot([feature])).toThrow(/exactly one of/);
  });

  test("rejects a filter with an empty options list", () => {
    const feature = dashboardFeature([STAT_PANEL], {
      id: "region",
      label: "demo:dashboard:filter:region",
      kind: "select",
      options: [],
    });
    expect(() => validateBoot([feature])).toThrow(/filter.options is empty/);
  });

  test("requiredKeysFromScreen sammelt stat-group-Kinder- und Filter-Labels, aber keine custom-Panel-Keys", () => {
    const screen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      filter: {
        id: "region",
        label: "demo:dashboard:filter:region",
        kind: "select",
        options: [{ value: "eu", label: "demo:dashboard:col:name" }],
      },
      panels: [
        {
          kind: "stat-group",
          id: "net-worth",
          label: "demo:dashboard:group:net-worth",
          stats: [STAT_PANEL],
        },
        {
          kind: "custom",
          id: "custom-panel",
          component: { react: { __component: "demo-custom" } },
        },
      ],
    };
    const keys = requiredKeysFromScreen("demo", screen);
    expect(keys).toContain("demo:dashboard:group:net-worth");
    expect(keys).toContain("demo:dashboard:panel:open-incidents");
    expect(keys).toContain("demo:dashboard:filter:region");
    expect(keys).toContain("demo:dashboard:col:name");
    expect(keys).not.toContain("custom-panel");
  });
});
