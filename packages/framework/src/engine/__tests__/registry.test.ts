import { describe, expect, test } from "bun:test";
import { createRegistry } from "../registry";
import type { FeatureDefinition } from "../types/feature";

// Hand-built FeatureDefinition that bypasses defineFeature() — the latter
// initializes every slot (entities, entityHooks, …) to an empty map. A
// FeatureDefinition assembled off that path (cast at a system boundary) can
// leave slots `undefined`, which the type forbids but createRegistry's
// entity-iteration paths must survive: `Object.entries/values(undefined)`
// throws. The double-cast is the deliberate type-violation that reproduces it.
function bareFeature(overrides: Record<string, unknown> = {}): FeatureDefinition {
  return {
    name: "probe",
    requires: [],
    optionalRequires: [],
    ...overrides,
  } as unknown as FeatureDefinition;
}

describe("createRegistry slot robustness", () => {
  // Regression for the hardening PRs (#95/#98/#210): the entity- and
  // hook-iterating paths in createRegistry must not assume the optional
  // `entities` / `entityHooks` slots are present. defineFeature masks this in
  // every test that goes through the normal author API, so the gap only
  // surfaced when a partial feature reached the boot path.

  test("tolerates a hand-built feature with entities + entityHooks omitted", () => {
    // Exercises the entity-iteration paths (allEntities loop + hasFieldAccessRules)
    // — both crash on `Object.{keys,values}(undefined)` without the `?? {}` guard.
    expect(() => createRegistry([bareFeature()])).not.toThrow();
  });

  test("tolerates entities: undefined (Object.keys/values guard)", () => {
    expect(() => createRegistry([bareFeature({ entities: undefined })])).not.toThrow();
  });

  test("tolerates entityHooks with every slot undefined", () => {
    expect(() =>
      createRegistry([
        bareFeature({
          entities: {},
          entityHooks: {
            postSave: undefined,
            preDelete: undefined,
            postDelete: undefined,
            postQuery: undefined,
          },
        }),
      ]),
    ).not.toThrow();
  });

  test("tolerates entityHooks map itself undefined", () => {
    expect(() =>
      createRegistry([bareFeature({ entities: {}, entityHooks: undefined })]),
    ).not.toThrow();
  });
});
