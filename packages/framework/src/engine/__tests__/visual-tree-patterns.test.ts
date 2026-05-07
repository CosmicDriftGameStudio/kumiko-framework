import { describe, expect, test } from "vitest";
import { createRegistry, defineFeature } from "../index";
import type { TreeNode, TreeProvider } from "../types/tree-node";

// Stub-Provider für Tests. Form: (ctx) => (emit) => unsubscribe.
// Emittet einmal initial, kein Cleanup nötig (no-op unsubscribe).
function makeStubProvider(nodes: readonly TreeNode[]): TreeProvider {
  return () => (emit) => {
    emit(nodes);
    return () => {};
  };
}

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

describe("r.tree — registrar slot", () => {
  test("feature without r.tree leaves the slot undefined", () => {
    const feature = defineFeature("empty", () => {});
    expect(feature.treeProvider).toBeUndefined();
  });

  test("single r.tree call stores the provider function on the FeatureDefinition", () => {
    const provider = makeStubProvider([{ label: "Marketing" }]);
    const feature = defineFeature("text-content", (r) => {
      r.tree(provider);
    });
    expect(feature.treeProvider).toBe(provider);
  });

  test("second r.tree call throws — only-once-guard", () => {
    expect(() =>
      defineFeature("dupe", (r) => {
        r.tree(makeStubProvider([]));
        r.tree(makeStubProvider([]));
      }),
    ).toThrow(/r\.tree\(\) already called/);
  });

  test("treeActions and tree are independent slots — can declare one without the other", () => {
    const onlyActions = defineFeature("a", (r) => {
      r.treeActions({ list: {} });
    });
    expect(onlyActions.treeActions).toBeDefined();
    expect(onlyActions.treeProvider).toBeUndefined();

    const onlyProvider = defineFeature("b", (r) => {
      r.tree(makeStubProvider([]));
    });
    expect(onlyProvider.treeActions).toBeUndefined();
    expect(onlyProvider.treeProvider).toBeDefined();
  });
});

describe("Registry.getTreeProviders + getTreeActions", () => {
  test("empty registry returns empty providers map and undefined actions", () => {
    const reg = createRegistry([]);
    expect(reg.getTreeProviders().size).toBe(0);
    expect(reg.getTreeActions("nonexistent")).toBeUndefined();
  });

  test("aggregates providers from multiple features keyed by feature name", () => {
    const providerA = makeStubProvider([{ label: "A-root" }]);
    const providerB = makeStubProvider([{ label: "B-root" }]);
    const featureA = defineFeature("text-content", (r) => {
      r.tree(providerA);
    });
    const featureB = defineFeature("legal-pages", (r) => {
      r.tree(providerB);
    });
    const reg = createRegistry([featureA, featureB]);

    const providers = reg.getTreeProviders();
    expect(providers.size).toBe(2);
    expect(providers.get("text-content")).toBe(providerA);
    expect(providers.get("legal-pages")).toBe(providerB);
  });

  test("features without r.tree are absent from the providers map (Zero-Whitelist-Filter)", () => {
    const featureWithProvider = defineFeature("text-content", (r) => {
      r.tree(makeStubProvider([]));
    });
    const featureWithoutProvider = defineFeature("schema-editor", () => {});
    const reg = createRegistry([featureWithProvider, featureWithoutProvider]);

    const providers = reg.getTreeProviders();
    expect(providers.has("text-content")).toBe(true);
    expect(providers.has("schema-editor")).toBe(false);
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
    const feature = defineFeature("no-actions", (r) => {
      r.tree(makeStubProvider([]));
    });
    const reg = createRegistry([feature]);

    expect(reg.getTreeActions("no-actions")).toBeUndefined();
  });
});
