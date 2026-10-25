import { describe, expect, test } from "bun:test";
import { parseRefTarget } from "../parse-ref-target.ts";

// Parser convention for ReferenceFieldDef: same-feature references use the common
// default, while cross-feature references require an explicit ":" prefix. These tests
// pin the splitting rule so the boot validator and renderer (via re-export) agree.

describe("parseRefTarget", () => {
  test("kurzer name: featureName = currentFeature, entityName = raw", () => {
    expect(parseRefTarget("user", "users")).toEqual({ featureName: "users", entityName: "user" });
  });

  test('qualifiziert "feature:entity": splittet am ersten Doppelpunkt', () => {
    expect(parseRefTarget("users:user", "shop")).toEqual({
      featureName: "users",
      entityName: "user",
    });
  });

  test("self-reference (kurz, gleicher entity-name) — currentFeature wandert durch", () => {
    expect(parseRefTarget("category", "shop")).toEqual({
      featureName: "shop",
      entityName: "category",
    });
  });

  test("kebab-case-feature: remains intact when split", () => {
    expect(parseRefTarget("public-status:incident", "shop")).toEqual({
      featureName: "public-status",
      entityName: "incident",
    });
  });

  test("second colon in entity-name (rare, but possible) — splits only at the FIRST", () => {
    // Feature and entity are kebab-case segments; the parser splits only at the first
    // ":". An entity name containing ":" passes through this parser but is rejected by
    // the boot validator, so downstream lookup cannot find it.
    expect(parseRefTarget("a:b:c", "shop")).toEqual({ featureName: "a", entityName: "b:c" });
  });
});
