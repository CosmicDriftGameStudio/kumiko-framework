import { describe, expect, test } from "bun:test";
import { buildTarget, createRegistry, defineFeature } from "../index";

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
// Schicht-1↔Schicht-2-Bridge: typed handle survives module-boundary.
//
// Diese Tests sind die kritische Architektur-Verification: r.treeActions
// returnt einen typed Handle, der via setup-export durch FeatureDefinition
// fließt und compile-time-typisiert vom Schicht-1-buildTarget konsumiert
// wird. Ohne diese Tests würde ein Type-Drift in einer der zwei Schichten
// erst spät sichtbar — siehe advisor-Verdict + Memory `[EventDef-
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

    // @ts-expect-error — slug muss string sein, nicht number
    buildTarget({ target: textContent.exports.handle, action: "edit", args: { slug: 42 } });

    // @ts-expect-error — list hat keine args, args-Feld nicht erlaubt
    buildTarget({ target: textContent.exports.handle, action: "list", args: { x: 1 } });

    // @ts-expect-error — edit braucht args, fehlt
    buildTarget({ target: textContent.exports.handle, action: "edit" });

    // Runtime-Coverage (Memory `[Keine Fake-Tests]`): der korrespondierende
    // Happy-Path über denselben typed Handle liefert valid TargetRef.
    // Beweist dass die Bridge nicht nur compile-time funktioniert sondern
    // runtime den richtigen TargetRef konstruiert.
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
