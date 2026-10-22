import { describe, expect, test } from "bun:test";
import { defineFeature } from "../engine/define-feature.ts";
import { featureDefinitionsOf } from "../schema-cli/validate-boot-input.ts";

describe("featureDefinitionsOf", () => {
  const realFeature = defineFeature("shape-probe", () => {});

  test("accepts a real feature definition", () => {
    expect(featureDefinitionsOf([realFeature])).toEqual([realFeature]);
  });

  test("names the missing key instead of blaming a valid name", () => {
    const { storeTables: _omitted, ...withoutStoreTables } = realFeature;
    expect(() => featureDefinitionsOf([withoutStoreTables])).toThrow(
      "FEATURES[0] is not a FeatureDefinition: `storeTables` must be an object",
    );
  });

  test("names a Set-typed key that arrived as an array", () => {
    expect(() => featureDefinitionsOf([{ ...realFeature, requiredSteps: [] }])).toThrow(
      "`requiredSteps` must be a Set",
    );
  });

  test("names a non-string name", () => {
    expect(() => featureDefinitionsOf([{ ...realFeature, name: 3 }])).toThrow(
      "`name` must be a string",
    );
  });
});
