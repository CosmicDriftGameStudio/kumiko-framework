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

function dashboardFeature(panels: DashboardScreenDefinition["panels"]) {
  return defineFeature("demo", (r) => {
    r.screen({ id: "overview", type: "dashboard", panels });
    r.translations({
      keys: {
        "screen:overview.title": { de: "Übersicht", en: "Overview" },
        "demo:dashboard:panel:open-incidents": { de: "Offene Vorfälle", en: "Open incidents" },
        "demo:dashboard:panel:latest": { de: "Neueste", en: "Latest" },
        "demo:dashboard:col:name": { de: "Name", en: "Name" },
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
});
