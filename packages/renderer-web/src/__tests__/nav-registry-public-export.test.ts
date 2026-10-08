import { describe, expect, test } from "bun:test";
import {
  buildAppSchema,
  createRegistry,
  defineFeature,
} from "@cosmicdrift/kumiko-framework/engine";
// Public entry on purpose: this test guards the exported API surface consumers import from.
import { buildNavRegistrySliceForApp } from "../index.js";

const adopter = defineFeature("adopter", (r) => {
  r.entity("thing", { fields: { label: { type: "text" } } });
  r.screen({ id: "home", type: "entityList", entity: "thing", columns: ["label"] });
  r.nav({ id: "home", label: "Home", screen: "home" });
  r.nav({ id: "orphan", label: "Orphan", screen: "home", parent: "app-shell:nav:missing" });
});

describe("buildNavRegistrySliceForApp public export", () => {
  const slice = buildNavRegistrySliceForApp(buildAppSchema(createRegistry([adopter])));

  test("keeps a nav without parent at top level", () => {
    expect(slice.topLevel.map((n) => n.id)).toEqual(["adopter:nav:home"]);
  });

  test("drops a nav whose parent does not exist from topLevel and byParent", () => {
    expect(slice.topLevel.map((n) => n.id)).not.toContain("adopter:nav:orphan");
    expect(slice.byParent("app-shell:nav:missing")).toEqual([]);
  });
});
