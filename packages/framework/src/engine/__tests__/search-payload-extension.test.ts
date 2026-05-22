import { describe, expect, test } from "vitest";
import { createEntity, createRegistry, defineFeature } from "../index";
import type { SearchPayloadContributorFn } from "../types";

// F3 — Search-Payload-Extension registers per-entity contributors that
// enrich the search-index doc during `buildSearchDocument`. Tests pin:
//   1. r.searchPayloadExtension(entity, fn) lands keyed by entity-name
//   2. Multiple contributors per entity stack (additive merge)
//   3. Registry getter returns ordered list
//   4. Empty for unknown entity
//   5. Contributor-Function-Signature passes correct args + returns extras
//   6. Boot-validation rejects typo'd entity-names (sibling-guard to
//      entity-hooks boot-validation — Memory feedback_entity_hook_boot_validation)

const noop: SearchPayloadContributorFn = () => ({});

describe("searchPayloadExtension registration", () => {
  test("r.searchPayloadExtension(entity, fn) lands in feature.searchPayloadExtensions", () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension(thing, noop);
    });

    const entry = feature.searchPayloadExtensions["thing"];
    expect(entry).toHaveLength(1);
  });

  test("multiple contributors on same entity stack additively", () => {
    const c1: SearchPayloadContributorFn = () => ({ a: 1 });
    const c2: SearchPayloadContributorFn = () => ({ b: 2 });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension(thing, c1);
      r.searchPayloadExtension(thing, c2);
    });

    expect(feature.searchPayloadExtensions["thing"]).toHaveLength(2);
  });
});

describe("Registry getter", () => {
  test("getSearchPayloadExtensions returns contributors", () => {
    const fn: SearchPayloadContributorFn = ({ state }) => ({ extra: state["id"] });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension(thing, fn);
    });

    const registry = createRegistry([feature]);
    const extensions = registry.getSearchPayloadExtensions("thing");
    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toBe(fn);
  });

  test("getSearchPayloadExtensions empty for unknown entity", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
    });

    const registry = createRegistry([feature]);
    expect(registry.getSearchPayloadExtensions("unknown")).toEqual([]);
  });
});

describe("Contributor-Function-Signature", () => {
  test("contributor receives entityName + entityId + state, returns extras to merge", async () => {
    const contributor: SearchPayloadContributorFn = ({ entityName, entityId, state }) => ({
      // Sanity-Check: contributor sees the exact args passed
      _entityName: entityName,
      _entityId: entityId,
      // Project state.tags into a flat searchable field
      flatTags: Array.isArray(state["tags"]) ? (state["tags"] as string[]).join(",") : "",
    });

    const feature = defineFeature("test", (r) => {
      const thing = r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension(thing, contributor);
    });

    const registry = createRegistry([feature]);
    const extensions = registry.getSearchPayloadExtensions("thing");
    const result = await extensions[0]?.({
      entityName: "thing",
      entityId: "t1",
      state: { id: "t1", tags: ["a", "b"] },
    });
    expect(result).toEqual({ _entityName: "thing", _entityId: "t1", flatTags: "a,b" });
  });
});

describe("Boot-Validation", () => {
  test("rejects searchPayloadExtension on unknown entity-name (sibling to entity-hooks)", () => {
    expect(() =>
      defineFeature("test", (r) => {
        r.entity("thing", createEntity({ table: "things", fields: {} }));
        // Typo: "propery" doesn't exist
        r.searchPayloadExtension("propery", noop);
      }),
    ).not.toThrow(); // defineFeature itself doesn't validate — registry does

    expect(() => {
      const feature = defineFeature("test", (r) => {
        r.entity("thing", createEntity({ table: "things", fields: {} }));
        r.searchPayloadExtension("propery", noop);
      });
      createRegistry([feature]);
    }).toThrow(/searchPayloadExtension.*"propery".*no entity/);
  });
});
