import { describe, expect, test } from "bun:test";
import type { ScreenDefinition } from "@cosmicdrift/kumiko-types/screen";

import { resolveExportPlan } from "../export-screen.ts";

const screen: ScreenDefinition = {
  id: "my-feature:screen:open-items",
  type: "projectionList",
  query: "my-feature:query:open-items",
  columns: ["title"],
  table: { export: { xlsx: true } },
};

// The registry keys features and screens in kebab form, whatever the feature was named.
const registry = {
  getScreen: (qn: string) => (qn === "my-feature:screen:open-items" ? screen : undefined),
  getScreenFeature: (qn: string) =>
    qn === "my-feature:screen:open-items" ? "myFeature" : undefined,
  getEntity: () => undefined,
};

describe("resolveExportPlan screen lookup", () => {
  test("a camelCase feature name from the client finds the kebab-keyed screen", () => {
    const plan = resolveExportPlan(registry, "myFeature:screen:openItems", ["title"], {
      roles: ["User"],
    });
    expect(plan.queryType).toBe("my-feature:query:open-items");
    expect(plan.screenShortId).toBe("open-items");
    expect(plan.columns[0]?.headerKey).toContain("myFeature:");
  });

  test("an unknown screen is still rejected", () => {
    expect(() =>
      resolveExportPlan(registry, "myFeature:screen:missing", ["title"], { roles: ["User"] }),
    ).toThrow();
  });
});
