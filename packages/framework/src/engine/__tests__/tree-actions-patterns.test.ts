import { describe, expect, test } from "bun:test";
import { buildTarget } from "../build-target.ts";
import { createRegistry, defineFeature } from "../index.ts";

describe("r.treeActions — registrar slot", () => {
  test("feature without r.treeActions leaves the slot undefined", () => {
    const feature = defineFeature("empty", () => {});
    expect(feature.treeActions).toBeUndefined();
  });

  test("single r.treeActions call stores the map on the FeatureDefinition", () => {
    const feature = defineFeature("text-content", (r) => {
      r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
    });
    expect(feature.treeActions).toEqual({
      edit: { args: { slug: "" } },
      list: {},
    });
  });

  test("returns a typed handle carrying id + literal-typed treeActions", () => {
    const feature = defineFeature("text-content", (r) => {
      const handle = r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
      return { handle };
    });
    expect(feature.exports.handle.id).toBe("text-content");
    expect(feature.exports.handle.treeActions).toEqual({
      edit: { args: { slug: "" } },
      list: {},
    });
  });

  test("second r.treeActions call throws — only-once-guard", () => {
    expect(() =>
      defineFeature("dupe", (r) => {
        r.treeActions({ edit: { args: { slug: "" as string } } });
        r.treeActions({ list: {} });
      }),
    ).toThrow(/r\.treeActions\(\) already called/);
  });

  test("returned handle is frozen — cannot mutate id or actions after creation", () => {
    const feature = defineFeature("text-content", (r) => {
      const handle = r.treeActions({ list: {} });
      return { handle };
    });
    expect(Object.isFrozen(feature.exports.handle)).toBe(true);
  });
});

describe("Registry.getTreeActions", () => {
  test("empty registry returns undefined actions", () => {
    const reg = createRegistry([]);
    expect(reg.getTreeActions("nonexistent")).toBeUndefined();
  });

  test("getTreeActions returns the erased map for a feature that declared r.treeActions", () => {
    const feature = defineFeature("text-content", (r) => {
      r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
    });
    const reg = createRegistry([feature]);

    expect(reg.getTreeActions("text-content")).toEqual({
      edit: { args: { slug: "" } },
      list: {},
    });
  });

  test("getTreeActions returns undefined for a feature without r.treeActions", () => {
    const feature = defineFeature("no-actions", () => {});
    const reg = createRegistry([feature]);

    expect(reg.getTreeActions("no-actions")).toBeUndefined();
  });
});

// =============================================================================
// Layer-1↔Layer-2 bridge: typed handle survives the module boundary.
//
// These tests verify the critical architecture: r.treeActions returns a
// typed handle that flows through the setup export via FeatureDefinition and
// is consumed with compile-time typing by the Layer-1 buildTarget. Without
// these tests, type drift between the two layers would only become visible
// later.
// =============================================================================

describe("Schicht-1↔Schicht-2 Bridge — buildTarget against real defineFeature handle", () => {
  test("buildTarget compiles + runs against handle from feature.exports", () => {
    const textContent = defineFeature("text-content", (r) => {
      const handle = r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
      return { handle };
    });

    // The proof: this call typechecks WITHOUT casts or unknowns.
    const ref = buildTarget({
      target: textContent.exports.handle,
      action: "edit",
      args: { slug: "imprint" },
    });
    expect(ref.featureId).toBe("text-content");
    expect(ref.action).toBe("edit");
    expect(ref.args).toEqual({ slug: "imprint" });
  });

  test("NoArgs-Action durch den Bridge — list ohne args", () => {
    const textContent = defineFeature("text-content", (r) => {
      const handle = r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
      return { handle };
    });
    const ref = buildTarget({ target: textContent.exports.handle, action: "list" });
    expect(ref).toEqual({ featureId: "text-content", action: "list" });
  });

  test("Compile-Time-Pinning — typed handle rejects falsche Calls (@ts-expect-error)", () => {
    const textContent = defineFeature("text-content", (r) => {
      const handle = r.treeActions({
        edit: { args: { slug: "" as string } },
        list: {},
      });
      return { handle };
    });

    // @ts-expect-error — "delet" is not an action in the handle
    buildTarget({ target: textContent.exports.handle, action: "delet", args: { slug: "x" } });

    // @ts-expect-error — slug must be a string, not a number
    buildTarget({ target: textContent.exports.handle, action: "edit", args: { slug: 42 } });

    // @ts-expect-error — list has no args; the args field is not allowed
    buildTarget({ target: textContent.exports.handle, action: "list", args: { x: 1 } });

    // @ts-expect-error — edit requires args, which are missing
    buildTarget({ target: textContent.exports.handle, action: "edit" });

    // Runtime coverage: the corresponding happy path through the same
    // typed handle returns a valid TargetRef.
    // This proves that the bridge works not only at compile time but also
    // constructs the correct TargetRef at runtime.
    const validRef = buildTarget({
      target: textContent.exports.handle,
      action: "edit",
      args: { slug: "imprint" },
    });
    expect(validRef.featureId).toBe("text-content");
    expect(validRef.action).toBe("edit");
    expect(validRef.args).toEqual({ slug: "imprint" });
  });
});
