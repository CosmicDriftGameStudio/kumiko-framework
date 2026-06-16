import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { buildSearchDocument } from "../../pipeline/system-hooks";
import { createEntity, createRegistry, createTextField, defineFeature } from "../index";
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

    const entry = feature.searchPayloadExtensions!["thing"];
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

    expect(feature.searchPayloadExtensions!["thing"]).toHaveLength(2);
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

describe("effectiveFeatures filtering", () => {
  test("getSearchPayloadExtensions filters contributors of feature-toggle-disabled bundles", () => {
    const fnA: SearchPayloadContributorFn = () => ({ a: 1 });
    const fnB: SearchPayloadContributorFn = () => ({ b: 2 });

    const featureA = defineFeature("bundleA", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension("thing", fnA);
    });
    const featureB = defineFeature("bundleB", (r) => {
      r.searchPayloadExtension("thing", fnB);
    });

    const registry = createRegistry([featureA, featureB]);

    // both effective → both fire
    expect(registry.getSearchPayloadExtensions("thing")).toHaveLength(2);

    // only bundleA effective → only fnA returned (bundleB filtered out)
    const onlyA = registry.getSearchPayloadExtensions("thing", new Set(["bundleA"]));
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0]).toBe(fnA);
  });
});

describe("buildSearchDocument — contributor precedence (base fields win)", () => {
  const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  afterEach(() => warnSpy.mockClear());

  function registryWith(contributor: SearchPayloadContributorFn) {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity(
        "thing",
        createEntity({ table: "things", fields: { title: createTextField({ searchable: true }) } }),
      );
      r.searchPayloadExtension(thing, contributor);
    });
    return createRegistry([feature]);
  }

  test("a contributor cannot overwrite an indexed Stammfield value", async () => {
    const registry = registryWith(() => ({ title: "from-contributor" }));
    const doc = await buildSearchDocument("thing", "t1", { title: "real-value" }, registry);
    expect(doc?.fields["title"]).toBe("real-value");
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("a non-colliding contributor key is still merged in", async () => {
    const registry = registryWith(() => ({ flatTags: "a,b" }));
    const doc = await buildSearchDocument("thing", "t1", { title: "real-value" }, registry);
    expect(doc?.fields).toMatchObject({ title: "real-value", flatTags: "a,b" });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test("collision dedup — same collision warns exactly once across calls", async () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity(
        "thing-dedup",
        createEntity({
          table: "things_dedup",
          fields: { title: createTextField({ searchable: true }) },
        }),
      );
      r.searchPayloadExtension(thing, () => ({ title: "from-contributor" }));
    });
    const registry = createRegistry([feature]);
    await buildSearchDocument("thing-dedup", "t1", { title: "real-value" }, registry);
    await buildSearchDocument("thing-dedup", "t1", { title: "real-value" }, registry);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  test("contributor-vs-contributor collision warns with the right message", async () => {
    const feature = defineFeature("test", (r) => {
      const thing = r.entity(
        "thing",
        createEntity({ table: "things", fields: { title: createTextField({ searchable: true }) } }),
      );
      r.searchPayloadExtension(thing, () => ({ overlap: "first" }));
      r.searchPayloadExtension(thing, () => ({ overlap: "second" }));
    });
    const registry = createRegistry([feature]);

    const doc = await buildSearchDocument("thing", "t1", { title: "real-value" }, registry);
    // Stammfield title → no collision. overlap is NOT a Stammfield, so the
    // second contributor's "overlap" collides with the first one's → "earlier contributor key".
    expect(doc?.fields["title"]).toBe("real-value");
    expect(doc?.fields["overlap"]).toBe("first");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[0]).toContain("earlier contributor key");
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
    }).toThrow(/searchPayloadExtension extension targets entity "propery" but no entity/);
  });

  test("error message calls a searchPayloadExtension an 'extension', not a 'hook'", () => {
    const feature = defineFeature("test", (r) => {
      r.entity("thing", createEntity({ table: "things", fields: {} }));
      r.searchPayloadExtension("propery", noop);
    });
    let message = "";
    try {
      createRegistry([feature]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("searchPayloadExtension extension");
    expect(message).not.toContain("searchPayloadExtension hook");
  });
});
