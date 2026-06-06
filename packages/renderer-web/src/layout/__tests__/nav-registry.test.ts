// nav-registry Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// buildNavRegistrySlice(ForApp) qualifiziert Feature-lokale Nav-IDs zu QNs
// (feature:nav:id), wendet einen optionalen Workspace-Allow-Filter an und
// baut topLevel + byParent. Pure, kein DOM.

import { describe, expect, test } from "bun:test";
import type {
  AppSchema,
  FeatureSchema,
  NavDefinition,
} from "@cosmicdrift/kumiko-framework/ui-types";
import { buildNavRegistrySlice, buildNavRegistrySliceForApp } from "../nav-tree";

function feature(navs: readonly NavDefinition[], featureName = "tasks"): FeatureSchema {
  return { featureName, entities: {}, screens: [], navs };
}

describe("buildNavRegistrySlice", () => {
  test("qualifiziert Nav-IDs zu feature:nav:id", () => {
    const slice = buildNavRegistrySlice(feature([{ id: "main", label: "Main" }]));
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:main"]);
  });

  test("parent-child: child unter byParent(qualified-parent), screen wird qualifiziert", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "main", label: "Main" },
        { id: "list", label: "List", parent: "main", screen: "task-list" },
      ]),
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:main"]);
    const children = slice.byParent("tasks:nav:main");
    expect(children.map((n) => n.id)).toEqual(["tasks:nav:list"]);
    expect(children[0]?.screen).toBe("tasks:screen:task-list");
  });

  test("allowedNavQns filtert nicht-erlaubte Navs raus", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "a", label: "A" },
        { id: "b", label: "B" },
      ]),
      new Set(["tasks:nav:a"]),
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:a"]);
  });

  test("child mit gedropptem Parent wird top-level (statt zu verschwinden)", () => {
    const slice = buildNavRegistrySlice(
      feature([
        { id: "main", label: "Main" },
        { id: "list", label: "List", parent: "main" },
      ]),
      new Set(["tasks:nav:list"]), // nur child erlaubt, parent gedroppt
    );
    expect(slice.topLevel.map((n) => n.id)).toEqual(["tasks:nav:list"]);
    expect(slice.byParent("tasks:nav:main")).toEqual([]);
  });
});

describe("buildNavRegistrySliceForApp", () => {
  test("qualifiziert Navs pro Feature (multi-feature)", () => {
    const app: AppSchema = {
      features: [
        feature([{ id: "catalog", label: "Catalog" }], "shop"),
        feature([{ id: "users", label: "Users" }], "admin"),
      ],
    };
    const slice = buildNavRegistrySliceForApp(app);
    expect(slice.topLevel.map((n) => n.id)).toEqual(["shop:nav:catalog", "admin:nav:users"]);
  });
});
