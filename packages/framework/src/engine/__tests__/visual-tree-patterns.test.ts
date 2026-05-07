import { describe, expect, test } from "vitest";
import { buildTarget, createRegistry, defineFeature } from "../index";
import type { TreeChildrenSubscribe, TreeNode } from "../types/tree-node";

// Stub-Provider für Tests. Form: (ctx) => (emit) => unsubscribe.
// Emittet einmal initial, kein Cleanup nötig (no-op unsubscribe).
function makeStubProvider(nodes: readonly TreeNode[]): TreeChildrenSubscribe {
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

// =============================================================================
// Schicht-1↔Schicht-2-Bridge: typed handle survives module-boundary.
//
// Diese Tests sind die kritische Architektur-Verification: r.treeActions
// returnt einen typed Handle, der via setup-export durch FeatureDefinition
// fließt und compile-time-typisiert vom Schicht-1-buildTarget konsumiert
// wird. Ohne diese Tests würde ein Type-Drift in einer der zwei Schichten
// erst in V.1.1 sichtbar — siehe advisor-Verdict + Memory `[EventDef-
// Exports-Pattern]`.
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

    // Der Beweis: dieser Call typecheckt OHNE Casts/unknowns.
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

    // @ts-expect-error — "delet" ist keine Action im Handle
    buildTarget({ target: textContent.exports.handle, action: "delet", args: { slug: "x" } });

    buildTarget({
      target: textContent.exports.handle,
      action: "edit",
      // @ts-expect-error — slug muss string sein, nicht number
      args: { slug: 42 },
    });

    buildTarget({
      target: textContent.exports.handle,
      action: "list",
      // @ts-expect-error — list hat keine args, args-Feld nicht erlaubt
      args: { x: 1 },
    });

    // @ts-expect-error — edit braucht args, fehlt
    buildTarget({ target: textContent.exports.handle, action: "edit" });
  });
});
