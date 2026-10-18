import { describe, expect, test } from "bun:test";
import { buildAppSchema } from "../build-app-schema.ts";
import { defineFeature } from "../define-feature.ts";
import { projectAppSchemaForRoles } from "../project-app-schema-for-roles.ts";
import { createRegistry } from "../registry.ts";
import { stripDisabledFeaturesFromAppSchema } from "../strip-disabled-features-from-app-schema.ts";

const gated = defineFeature("gated", (r) => {
  r.toggleable({ default: false });
  r.screen({
    id: "locked",
    type: "dashboard",
    visibleWhen: { query: "gated:query:availability", field: "enabled", eq: true },
    fallback: "upgrade",
    panels: [],
  });
  r.screen({ id: "upgrade", type: "dashboard", fallback: "upgrade-detail", panels: [] });
  r.screen({ id: "upgrade-detail", type: "dashboard", panels: [] });
  r.screen({ id: "internal", type: "dashboard", panels: [] });
  r.nav({ id: "locked", label: "Locked", screen: "locked" });
});

const crossGated = defineFeature("cross-gated", (r) => {
  r.toggleable({ default: false });
  r.screen({
    id: "locked",
    type: "dashboard",
    visibleWhen: { query: "cross-gated:query:availability", field: "enabled", eq: true },
    fallback: "host:screen:upgrade",
    panels: [],
  });
});

const host = defineFeature("host", (r) => {
  r.screen({ id: "upgrade", type: "dashboard", panels: [] });
  r.nav({ id: "to-locked", label: "Locked", screen: "gated:screen:locked" });
  r.nav({ id: "to-internal", label: "Internal", screen: "gated:screen:internal" });
});

const registry = createRegistry([gated, crossGated, host]);

function screenIds(featureName: string, schema: ReturnType<typeof buildAppSchema>): string[] {
  return schema.features.find((f) => f.featureName === featureName)?.screens.map((s) => s.id) ?? [];
}

describe("stripDisabledFeaturesFromAppSchema", () => {
  const stripped = stripDisabledFeaturesFromAppSchema(buildAppSchema(registry), registry, [
    "gated",
  ]);

  test("keeps screens with a fallback and the same-feature screens the fallbacks chain to", () => {
    expect(screenIds("gated", stripped).sort()).toEqual(["locked", "upgrade", "upgrade-detail"]);
  });

  test("drops screens without a fallback and the navs of the disabled feature", () => {
    expect(screenIds("gated", stripped)).not.toContain("internal");
    expect(stripped.features.find((f) => f.featureName === "gated")?.navs).toBeUndefined();
  });

  test("a nav of another feature on a kept screen survives the role projection", () => {
    const projected = projectAppSchemaForRoles(stripped, ["User"]);
    const navs = projected.features.find((f) => f.featureName === "host")?.navs ?? [];
    expect(navs.map((n) => n.id)).toEqual(["to-locked"]);
  });

  test("a cross-feature fallback keeps the locked screen and leaves the target feature untouched", () => {
    const schema = buildAppSchema(registry);
    const result = stripDisabledFeaturesFromAppSchema(schema, registry, ["cross-gated"]);
    expect(screenIds("cross-gated", result)).toEqual(["locked"]);
    expect(result.features.find((f) => f.featureName === "host")).toEqual(
      schema.features.find((f) => f.featureName === "host"),
    );
  });
});
