import { describe, expect, test } from "bun:test";
import { parseRefTarget } from "../parse-ref-target";

// Tier 2.7e Cross-Feature: parser-Konvention für ReferenceFieldDef.
// Same-feature default ist der häufige Pfad; cross-feature verlangt
// expliziten ":"-Prefix. Diese Tests pinnen die Aufteilungsregel
// damit Boot-Validator und Renderer (über Re-Export) übereinstimmen.

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

  test("kebab-case-feature: bleibt erhalten beim split", () => {
    expect(parseRefTarget("public-status:incident", "shop")).toEqual({
      featureName: "public-status",
      entityName: "incident",
    });
  });

  test("zweiter Doppelpunkt im entity-name (selten, aber möglich) — splittet nur am ERSTEN", () => {
    // Konvention: feature und entity sind kebab-segments; der parser
    // splittet conservative am ersten ":". Falls der Author einen
    // entity-name mit ":" deklariert (was Boot-Validator ohnehin
    // ablehnt), läuft er hier durch — der downstream-Lookup findet
    // ihn dann nicht und failt.
    expect(parseRefTarget("a:b:c", "shop")).toEqual({ featureName: "a", entityName: "b:c" });
  });
});
