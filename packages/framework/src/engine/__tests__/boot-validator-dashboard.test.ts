import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { requiredKeysFromScreen } from "../../i18n/required-surface-keys.js";
import { validateBoot } from "../boot-validator.js";
import { defineFeature } from "../define-feature.js";
import type { DashboardScreenDefinition, DashboardScreenPanel } from "../types/screen.js";

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
  extra: Partial<Pick<DashboardScreenDefinition, "timeRange" | "scope">> = {},
) {
  return defineFeature("demo", (r) => {
    r.queryHandler("incident:open-count", z.object({}), async () => ({ count: 3 }), {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.queryHandler("incident:latest", z.object({}), async () => ({ rows: [], nextCursor: null }), {
      access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
    });
    r.screen({
      id: "overview",
      type: "dashboard",
      panels,
      ...(filter !== undefined && { filter }),
      ...extra,
    });
    r.translations({
      keys: {
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
        "demo:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
        "demo:dashboard:col:name": { de: "Name", en: "Name" },
        "demo:dashboard:group:net-worth": { de: "Net Worth", en: "Net Worth" },
        "demo:dashboard:filter:region": { de: "Region", en: "Region" },
        "demo:dashboard:range:7d": { de: "7 Tage", en: "7 days" },
        "demo:dashboard:range:30d": { de: "30 Tage", en: "30 days" },
        "demo:dashboard:scope:badge": { de: "Alle Tenants", en: "All tenants" },
        "demo:dashboard:scope:notice": { de: "Hinweis", en: "Notice" },
        "demo:dashboard:chart:subtitle": { de: "7 Tage", en: "7 days" },
        "demo:dashboard:chart:empty": { de: "Leer", en: "Empty" },
        "demo:dashboard:chart:empty-hint": { de: "Später", en: "Later" },
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

  test("accepts span half/full and rejects anything else", () => {
    const list = (span: string) =>
      dashboardFeature([
        {
          kind: "list",
          id: "latest",
          label: "demo:dashboard:panel:latest",
          query: "demo:query:incident:latest",
          columns: ["name"],
          span: span as "half",
        },
      ]);
    expect(() => validateBoot([list("half")])).not.toThrow();
    expect(() => validateBoot([list("full")])).not.toThrow();
    expect(() => validateBoot([list("third")])).toThrow(/expected "half" or "full"/);
  });

  test("accepts span on a stat-group and rejects anything but half/full", () => {
    const group = (span: string) =>
      dashboardFeature([
        {
          kind: "stat-group",
          id: "totals",
          label: "demo:dashboard:panel:latest",
          span: span as "half",
          stats: [STAT_PANEL],
        },
      ]);
    expect(() => validateBoot([group("half")])).not.toThrow();
    expect(() => validateBoot([group("third")])).toThrow(/expected "half" or "full"/);
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

  test("rejects a filter with an empty optionsQuery", () => {
    const feature = dashboardFeature([STAT_PANEL], {
      id: "region",
      label: "demo:dashboard:filter:region",
      kind: "select",
      optionsQuery: "",
    });
    expect(() => validateBoot([feature])).toThrow(/filter.optionsQuery is empty/);
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

const catalogFeature = defineFeature("catalog", (r) => {
  r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.queryHandler("items:status", z.object({}), async () => ({ enabled: true }), {
    access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
  });
  r.screen({
    id: "items",
    type: "projectionList",
    query: "catalog:query:items:list",
    columns: ["name"],
  });
  r.screen({
    id: "items-overview",
    type: "dashboard",
    panels: [STAT_PANEL],
  });
  r.translations({
    keys: {
      "screen:items.title": { de: "Artikel", en: "Items" },
      "screen:items-overview.title": { de: "Übersicht", en: "Overview" },
      "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
    },
  });
});

function screenPanelFeature(panel: DashboardScreenPanel) {
  return dashboardFeature([STAT_PANEL, panel]);
}

describe("validateBoot — dashboard screen panels (fw#2841)", () => {
  test("accepts a cross-feature projectionList target with a registered visibleWhen query", () => {
    const feature = screenPanelFeature({
      kind: "screen",
      id: "items",
      screen: "catalog:screen:items",
      label: "demo:dashboard:panel:latest",
      visibleWhen: { query: "catalog:query:items:status", field: "enabled", eq: true },
    });
    expect(() => validateBoot([feature, catalogFeature])).not.toThrow();
  });

  test("accepts a same-feature short id", () => {
    const feature = defineFeature("demo", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "demo:query:items:list",
        columns: ["name"],
      });
      r.screen({
        id: "overview",
        type: "dashboard",
        panels: [{ kind: "screen", id: "items", screen: "items" }],
      });
      r.translations({
        keys: {
          "screen:items.title": { de: "Artikel", en: "Items" },
          "screen:overview.title": { de: "Übersicht", en: "Overview" },
        },
      });
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects a target that resolves to no registered screen", () => {
    const feature = screenPanelFeature({
      kind: "screen",
      id: "items",
      screen: "catalog:screen:ghost",
    });
    expect(() => validateBoot([feature, catalogFeature])).toThrow(
      /screen-panel "items" screen "catalog:screen:ghost" does not resolve/,
    );
  });

  test("rejects a short id that only exists in another feature", () => {
    const feature = screenPanelFeature({ kind: "screen", id: "items", screen: "items" });
    expect(() => validateBoot([feature, catalogFeature])).toThrow(/checked "demo:screen:items"/);
  });

  test("rejects embedding a dashboard (no nesting)", () => {
    const feature = screenPanelFeature({
      kind: "screen",
      id: "nested",
      screen: "catalog:screen:items-overview",
    });
    expect(() => validateBoot([feature, catalogFeature])).toThrow(
      /of type "dashboard", which can't be embedded/,
    );
  });

  test("rejects a visibleWhen query that is not registered", () => {
    const feature = screenPanelFeature({
      kind: "screen",
      id: "items",
      screen: "catalog:screen:items",
      visibleWhen: { query: "catalog:query:items:ghost", field: "enabled", eq: true },
    });
    expect(() => validateBoot([feature, catalogFeature])).toThrow(
      /screen-panel "items" visibleWhen query "catalog:query:items:ghost" is not a registered query-handler/,
    );
  });

  describe("visibleWhen field against the query outputSchema", () => {
    const typedCatalog = defineFeature("catalog", (r) => {
      r.queryHandler("items:list", z.object({}), async () => ({ rows: [], nextCursor: null }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler("items:status", z.object({}), async () => ({ enabled: true }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        outputSchema: z.object({ enabled: z.boolean() }),
      });
      r.screen({
        id: "items",
        type: "projectionList",
        query: "catalog:query:items:list",
        columns: ["name"],
      });
      r.translations({ keys: { "screen:items.title": { de: "Artikel", en: "Items" } } });
    });

    test("rejects a visibleWhen field missing from the declared outputSchema", () => {
      const feature = screenPanelFeature({
        kind: "screen",
        id: "items",
        screen: "catalog:screen:items",
        label: "demo:dashboard:panel:latest",
        visibleWhen: { query: "catalog:query:items:status", field: "enable", eq: true },
      });
      expect(() => validateBoot([feature, typedCatalog])).toThrow(
        /screen-panel "items" visibleWhen references field "enable" which is not present in query "catalog:query:items:status"'s outputSchema/,
      );
    });

    test("accepts a visibleWhen field present in the declared outputSchema", () => {
      const feature = screenPanelFeature({
        kind: "screen",
        id: "items",
        screen: "catalog:screen:items",
        label: "demo:dashboard:panel:latest",
        visibleWhen: { query: "catalog:query:items:status", field: "enabled", eq: true },
      });
      expect(() => validateBoot([feature, typedCatalog])).not.toThrow();
    });
  });

  test("rejects a visibleWhen with an empty field", () => {
    const feature = screenPanelFeature({
      kind: "screen",
      id: "items",
      screen: "catalog:screen:items",
      visibleWhen: { query: "catalog:query:items:status", field: "", eq: true },
    });
    expect(() => validateBoot([feature, catalogFeature])).toThrow(
      /visibleWhen needs a non-empty query and field/,
    );
  });

  describe("embedded actionForm redirect/cancelTarget", () => {
    function formFeature(extra: Record<string, unknown>) {
      return defineFeature("forms", (r) => {
        r.writeHandler({
          name: "restock",
          schema: { _type: "stub" } as never,
          handler: async () => ({ isSuccess: true, data: {} }) as never,
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "restock",
          type: "actionForm",
          handler: "forms:write:restock",
          fields: { note: { type: "text" } } as never,
          layout: { sections: [{ fields: ["note"] }] },
          ...extra,
        } as never);
        r.queryHandler("done", z.object({}), async () => ({ rows: [], nextCursor: null }), {
          access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        });
        r.screen({
          id: "restock-done",
          type: "projectionList",
          query: "forms:query:done",
          columns: ["name"],
        });
        r.translations({
          keys: {
            "screen:restock.title": { de: "Nachfüllen", en: "Restock" },
            "screen:restock-done.title": { de: "Erledigt", en: "Done" },
            "forms:entity:__action-form__:field:note": { de: "Notiz", en: "Note" },
          },
        });
      });
    }
    const panel = { kind: "screen", id: "restock", screen: "forms:screen:restock" } as const;

    test("a target with a redirect throws", () => {
      expect(() =>
        validateBoot([screenPanelFeature(panel), formFeature({ redirect: "restock-done" })]),
      ).toThrow(/embeds "forms:screen:restock", which sets redirect\/cancelTarget/);
    });

    test("a target with a cancelTarget throws", () => {
      expect(() =>
        validateBoot([screenPanelFeature(panel), formFeature({ cancelTarget: "restock-done" })]),
      ).toThrow(/which sets redirect\/cancelTarget/);
    });

    test("a target without redirect and with cancelTarget false boots", () => {
      expect(() =>
        validateBoot([screenPanelFeature(panel), formFeature({ cancelTarget: false })]),
      ).not.toThrow();
    });
  });

  test("requiredKeysFromScreen sammelt ein gesetztes Screen-Panel-Label", () => {
    const screen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "screen",
          id: "items",
          screen: "catalog:screen:items",
          label: "demo:dashboard:panel:latest",
        },
      ],
    };
    expect(requiredKeysFromScreen("demo", screen)).toContain("demo:dashboard:panel:latest");
  });
});

describe("validateBoot — dashboard timeRange, scope and new panel fields", () => {
  const TIME_RANGE = {
    id: "range",
    options: [
      { value: "7d", label: "demo:dashboard:range:7d" },
      { value: "30d", label: "demo:dashboard:range:30d" },
    ],
    default: "7d",
  } as const;

  test("accepts a valid timeRange and scope", () => {
    const feature = dashboardFeature([STAT_PANEL], undefined, {
      timeRange: TIME_RANGE,
      scope: { badge: "demo:dashboard:scope:badge", notice: "demo:dashboard:scope:notice" },
    });
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects a timeRange without options", () => {
    const feature = dashboardFeature([STAT_PANEL], undefined, {
      timeRange: { ...TIME_RANGE, options: [] },
    });
    expect(() => validateBoot([feature])).toThrow(/timeRange\.options is empty/);
  });

  test("rejects a timeRange default that is not among the options", () => {
    const feature = dashboardFeature([STAT_PANEL], undefined, {
      timeRange: { ...TIME_RANGE, default: "90d" },
    });
    expect(() => validateBoot([feature])).toThrow(/default "90d" is not among the options/);
  });

  test("rejects duplicate timeRange option values", () => {
    const feature = dashboardFeature([STAT_PANEL], undefined, {
      timeRange: {
        ...TIME_RANGE,
        options: [
          { value: "7d", label: "demo:dashboard:range:7d" },
          { value: "7d", label: "demo:dashboard:range:30d" },
        ],
      },
    });
    expect(() => validateBoot([feature])).toThrow(/duplicate value "7d"/);
  });

  test("rejects a timeRange id that collides with the filter id", () => {
    const feature = dashboardFeature(
      [STAT_PANEL],
      {
        id: "range",
        label: "demo:dashboard:filter:region",
        kind: "select",
        options: [{ value: "eu", label: "demo:dashboard:filter:region" }],
      },
      { timeRange: TIME_RANGE },
    );
    expect(() => validateBoot([feature])).toThrow(/collides with the filter id/);
  });

  test("accepts a label-less stat-group and every chart kind with their query refs", () => {
    const feature = dashboardFeature([
      {
        kind: "stat-group",
        id: "kpis",
        stats: [{ ...STAT_PANEL, id: "a", sparklineField: "points", ignoreScreenFilter: true }],
      },
      ...(["timeseries", "stacked-bars", "segment-bars", "stacked-area"] as const).map((chart) => ({
        kind: "chart" as const,
        id: `chart-${chart}`,
        label: "demo:dashboard:panel:latest",
        chart,
        query: "demo:query:incident:latest",
      })),
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("accepts valueFormat on stat and chart panels and scrollable on stacked-area", () => {
    const feature = dashboardFeature([
      { ...STAT_PANEL, valueFormat: { kind: "currency", currency: "EUR", fractionDigits: 0 } },
      {
        kind: "chart",
        id: "area",
        label: "demo:dashboard:panel:latest",
        chart: "stacked-area",
        query: "demo:query:incident:latest",
        valueFormat: { kind: "currency", currency: "EUR" },
        scrollable: true,
      },
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test.each([
    ["lowercase", { kind: "currency", currency: "eur" }],
    ["too long", { kind: "currency", currency: "EURO" }],
    ["negative digits", { kind: "currency", currency: "EUR", fractionDigits: -1 }],
    ["fractional digits", { kind: "currency", currency: "EUR", fractionDigits: 1.5 }],
    ["too many digits", { kind: "currency", currency: "EUR", fractionDigits: 5 }],
  ] as const)("rejects an invalid valueFormat (%s)", (_name, valueFormat) => {
    const feature = dashboardFeature([{ ...STAT_PANEL, valueFormat }]);
    expect(() => validateBoot([feature])).toThrow(/valueFormat/);
  });

  test("rejects an invalid valueFormat on a stat-group child", () => {
    const feature = dashboardFeature([
      {
        kind: "stat-group",
        id: "kpis",
        stats: [{ ...STAT_PANEL, valueFormat: { kind: "currency", currency: "€" } }],
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/valueFormat\.currency/);
  });

  test("rejects scrollable on every chart kind except stacked-area", () => {
    for (const chart of ["timeseries", "stacked-bars", "segment-bars"] as const) {
      const feature = dashboardFeature([
        {
          kind: "chart",
          id: "c",
          label: "demo:dashboard:panel:latest",
          chart,
          query: "demo:query:incident:latest",
          scrollable: true,
        },
      ]);
      expect(() => validateBoot([feature])).toThrow(/only "stacked-area" supports it/);
    }
  });

  test("a chart panel with an unregistered query is still rejected", () => {
    const feature = dashboardFeature([
      {
        kind: "chart",
        id: "ghost",
        label: "demo:dashboard:panel:latest",
        chart: "stacked-bars",
        query: "demo:query:incident:ghost",
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/ghost/);
  });

  test("requiredKeysFromScreen collects the new i18n keys", () => {
    const screen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      timeRange: TIME_RANGE,
      scope: { badge: "demo:dashboard:scope:badge", notice: "demo:dashboard:scope:notice" },
      panels: [
        {
          kind: "chart",
          id: "c",
          label: "demo:dashboard:panel:latest",
          chart: "stacked-bars",
          query: "demo:query:incident:latest",
          subtitle: "demo:dashboard:chart:subtitle",
          emptyLabel: "demo:dashboard:chart:empty",
          emptyHint: "demo:dashboard:chart:empty-hint",
        },
      ],
    };
    const keys = requiredKeysFromScreen("demo", screen);
    for (const key of [
      "demo:dashboard:range:7d",
      "demo:dashboard:range:30d",
      "demo:dashboard:scope:badge",
      "demo:dashboard:scope:notice",
      "demo:dashboard:chart:subtitle",
      "demo:dashboard:chart:empty",
      "demo:dashboard:chart:empty-hint",
    ]) {
      expect(keys).toContain(key);
    }
  });
});

describe("validateBoot — dashboard panel gates, stat-group subtitle and stacked-area extras", () => {
  const GATE = { query: "demo:query:portfolio:state", field: "state", eq: "filled" } as const;
  const AREA = {
    kind: "chart",
    id: "plan",
    label: "demo:dashboard:panel:latest",
    chart: "stacked-area",
    query: "demo:query:incident:latest",
  } as const;
  const RANGES = {
    options: [
      { value: "1y", label: "demo:dashboard:range:1y", months: 12 },
      { value: "max", label: "demo:dashboard:range:max" },
    ],
    default: "1y",
  } as const;

  function gatedFeature(panels: DashboardScreenDefinition["panels"]) {
    return defineFeature("demo", (r) => {
      r.queryHandler("incident:open-count", z.object({}), async () => ({ count: 3 }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler("incident:latest", z.object({}), async () => ({ rows: [] }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
      });
      r.queryHandler("portfolio:state", z.object({}), async () => ({ state: "filled" }), {
        access: { openToAll: { reason: "test handler callable by any signed-in test user" } },
        outputSchema: z.object({ state: z.string() }),
      });
      r.screen({ id: "overview", type: "dashboard", panels });
      r.translations({
        keys: {
          "screen:overview.title": { de: "Übersicht", en: "Overview" },
          "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
          "demo:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
          "demo:dashboard:group:net-worth": { de: "Vermögen", en: "Net worth" },
          "demo:dashboard:group:net-worth-sub": { de: "Ohne Ordnerfilter", en: "All folders" },
          "demo:dashboard:range:1y": { de: "1 Jahr", en: "1 year" },
          "demo:dashboard:range:max": { de: "Max", en: "Max" },
          "demo:dashboard:marker:payoff": { de: "Ablösung", en: "Payoff" },
        },
      });
    });
  }

  test("accepts visibleWhen on stat, stat-group, feed, progress-list, chart and list panels", () => {
    const feature = gatedFeature([
      { ...STAT_PANEL, visibleWhen: GATE },
      {
        kind: "stat-group",
        id: "net-worth",
        label: "demo:dashboard:group:net-worth",
        subtitle: "demo:dashboard:group:net-worth-sub",
        visibleWhen: GATE,
        stats: [{ ...STAT_PANEL, id: "child" }],
      },
      {
        kind: "feed",
        id: "feed",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        visibleWhen: GATE,
      },
      {
        kind: "progress-list",
        id: "progress",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        visibleWhen: GATE,
      },
      { ...AREA, visibleWhen: GATE },
      {
        kind: "list",
        id: "list",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        columns: [{ field: "name", label: "demo:dashboard:panel:latest" }],
        visibleWhen: GATE,
      },
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test("rejects a panel gate whose query is not registered", () => {
    const feature = gatedFeature([
      { ...STAT_PANEL, visibleWhen: { ...GATE, query: "demo:query:portfolio:ghost" } },
    ]);
    expect(() => validateBoot([feature])).toThrow(
      /panel "open-incidents" visibleWhen query "demo:query:portfolio:ghost" is not a registered query-handler/,
    );
  });

  test("rejects a panel gate field missing from the outputSchema", () => {
    const feature = gatedFeature([
      {
        kind: "feed",
        id: "feed",
        label: "demo:dashboard:panel:latest",
        query: "demo:query:incident:latest",
        visibleWhen: { ...GATE, field: "status" },
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(
      /panel "feed" visibleWhen references field "status" which is not present/,
    );
  });

  test("rejects a panel gate with an empty field", () => {
    const feature = gatedFeature([
      {
        kind: "stat-group",
        id: "kpis",
        visibleWhen: { ...GATE, field: "" },
        stats: [STAT_PANEL],
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/visibleWhen needs a non-empty query and field/);
  });

  test("rejects visibleWhen on a stat-group child", () => {
    const feature = gatedFeature([
      { kind: "stat-group", id: "kpis", stats: [{ ...STAT_PANEL, visibleWhen: GATE }] },
    ]);
    expect(() => validateBoot([feature])).toThrow(/child "open-incidents" sets visibleWhen/);
  });

  test("rejects a stat-group subtitle without label", () => {
    const feature = gatedFeature([
      {
        kind: "stat-group",
        id: "kpis",
        subtitle: "demo:dashboard:group:net-worth-sub",
        stats: [STAT_PANEL],
      },
    ]);
    expect(() => validateBoot([feature])).toThrow(/sets subtitle without label/);
  });

  test("accepts markerKinds, legendTotals, ranges and seriesColors on stacked-area", () => {
    const feature = gatedFeature([
      {
        ...AREA,
        seriesColors: { remaining: "var(--color-debt)" },
        markerKinds: { payoff: { tone: "positive" }, extra: { color: "var(--color-extra)" } },
        legendTotals: false,
        ranges: RANGES,
      },
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test.each([
    ["markerKinds", { markerKinds: { payoff: { tone: "positive" } } }],
    ["legendTotals", { legendTotals: false }],
    ["ranges", { ranges: RANGES }],
    ["brush", { brush: true }],
    ["dateFormat", { dateFormat: "month" }],
    ["initialWindow", { initialWindow: "from-today" }],
    ["markerLegend", { markerLegend: "legend" }],
  ] as const)("rejects %s on a chart kind other than stacked-area", (prop, extra) => {
    const feature = gatedFeature([{ ...AREA, chart: "stacked-bars", ...extra }]);
    expect(() => validateBoot([feature])).toThrow(
      new RegExp(`sets ${prop} on chart "stacked-bars"`),
    );
  });

  test.each([
    ["empty options", { ...RANGES, options: [] }, /ranges\.options is empty/],
    [
      "unknown default",
      { ...RANGES, default: "5y" },
      /ranges\.default "5y" is not among the options/,
    ],
    [
      "duplicate value",
      { ...RANGES, options: [RANGES.options[0], RANGES.options[0]] },
      /ranges\.options has duplicate value "1y"/,
    ],
    [
      "fractional months",
      { ...RANGES, options: [{ value: "1y", label: "demo:dashboard:range:1y", months: 1.5 }] },
      /option "1y" months "1.5" must be a positive integer/,
    ],
    [
      "zero months",
      { ...RANGES, options: [{ value: "1y", label: "demo:dashboard:range:1y", months: 0 }] },
      /option "1y" months "0" must be a positive integer/,
    ],
  ] as const)("rejects invalid ranges (%s)", (_name, ranges, message) => {
    const feature = gatedFeature([{ ...AREA, ranges }]);
    expect(() => validateBoot([feature])).toThrow(message);
  });

  test("accepts brush on stacked-area and rejects a non-boolean brush", () => {
    expect(() => validateBoot([gatedFeature([{ ...AREA, brush: true }])])).not.toThrow();
    const feature = gatedFeature([{ ...AREA, brush: "yes" as unknown as boolean }]);
    expect(() => validateBoot([feature])).toThrow(/non-boolean brush/);
  });

  test("accepts dateFormat, initialWindow, markerLegend and a marker kind label on stacked-area", () => {
    const feature = gatedFeature([
      {
        ...AREA,
        dateFormat: "day",
        initialWindow: "from-today",
        markerLegend: "legend",
        markerKinds: { payoff: { tone: "positive", label: "demo:dashboard:marker:payoff" } },
      },
    ]);
    expect(() => validateBoot([feature])).not.toThrow();
  });

  test.each([
    ["dateFormat", { dateFormat: "year" }, /dateFormat "year" must be one of day, month/],
    [
      "initialWindow",
      { initialWindow: "today" },
      /initialWindow "today" must be one of default-range, from-today/,
    ],
    ["markerLegend", { markerLegend: "table" }, /markerLegend "table" must be one of list, legend/],
  ] as const)("rejects an invalid %s value", (_prop, extra, message) => {
    const feature = gatedFeature([{ ...AREA, ...(extra as object) }]);
    expect(() => validateBoot([feature])).toThrow(message);
  });

  test("rejects an empty marker kind label", () => {
    const feature = gatedFeature([
      { ...AREA, markerKinds: { payoff: { tone: "positive", label: " " } } },
    ]);
    expect(() => validateBoot([feature])).toThrow(
      /markerKinds\["payoff"\]\.label must be a non-empty i18n key/,
    );
  });

  test("rejects a marker kind without tone and color", () => {
    const feature = gatedFeature([{ ...AREA, markerKinds: { payoff: {} } }]);
    expect(() => validateBoot([feature])).toThrow(
      /markerKinds\["payoff"\] needs a tone or a color/,
    );
  });

  test("rejects an empty seriesColors entry", () => {
    const feature = gatedFeature([{ ...AREA, seriesColors: { remaining: " " } }]);
    expect(() => validateBoot([feature])).toThrow(
      /seriesColors\["remaining"\] must be a non-empty CSS color/,
    );
  });

  test("requiredKeysFromScreen collects the stat-group subtitle and range labels", () => {
    const screen: DashboardScreenDefinition = {
      id: "overview",
      type: "dashboard",
      panels: [
        {
          kind: "stat-group",
          id: "net-worth",
          label: "demo:dashboard:group:net-worth",
          subtitle: "demo:dashboard:group:net-worth-sub",
          stats: [STAT_PANEL],
        },
        { ...AREA, ranges: RANGES },
      ],
    };
    const keys = requiredKeysFromScreen("demo", screen);
    for (const key of [
      "demo:dashboard:group:net-worth-sub",
      "demo:dashboard:range:1y",
      "demo:dashboard:range:max",
    ]) {
      expect(keys).toContain(key);
    }
  });
});
