import { describe, expect, test } from "bun:test";
import { buildTarget } from "../build-target.ts";
import type { TreeActionDef } from "../index.ts";

// createTreeActionsStub — Test helper for stub features. The
// `const` generic modifier forces literal inference so action names arrive
// as a string-literal union instead of widening to `string`. Real
// defineFeature outputs have the same shape, so tests can consume them
// directly.
function createTreeActionsStub<const TActions extends Record<string, TreeActionDef>>(spec: {
  readonly id: string;
  readonly treeActions: TActions;
}): { readonly id: string; readonly treeActions: TActions } {
  return Object.freeze({ id: spec.id, treeActions: spec.treeActions });
}

const textContentStub = createTreeActionsStub({
  id: "text-content",
  treeActions: {
    edit: { args: { slug: "" as string } },
    create: { args: { folder: "" as string } },
    list: {},
  },
});

describe("buildTarget — NoArgs-Action", () => {
  test("erzeugt TargetRef ohne args-Feld", () => {
    const ref = buildTarget({ target: textContentStub, action: "list" });
    expect(ref).toEqual({ featureId: "text-content", action: "list" });
    expect("args" in ref).toBe(false);
  });

  test("output ist frozen (immutable)", () => {
    const ref = buildTarget({ target: textContentStub, action: "list" });
    expect(Object.isFrozen(ref)).toBe(true);
  });
});

describe("buildTarget — WithArgs-Action", () => {
  test("erzeugt TargetRef mit args", () => {
    const ref = buildTarget({
      target: textContentStub,
      action: "edit",
      args: { slug: "imprint" },
    });
    expect(ref).toEqual({
      featureId: "text-content",
      action: "edit",
      args: { slug: "imprint" },
    });
  });

  test("args sind frozen — Mutation am Input-Objekt schlägt nicht durch", () => {
    const inputArgs = { slug: "imprint" };
    const ref = buildTarget({
      target: textContentStub,
      action: "edit",
      args: inputArgs,
    });
    inputArgs.slug = "mutated";
    expect(ref.args).toEqual({ slug: "imprint" });
    expect(Object.isFrozen(ref.args)).toBe(true);
  });

  test("verschiedene Actions haben unterschiedliche Arg-Shapes", () => {
    const editRef = buildTarget({
      target: textContentStub,
      action: "edit",
      args: { slug: "imprint" },
    });
    const createRef = buildTarget({
      target: textContentStub,
      action: "create",
      args: { folder: "/marketing" },
    });
    expect(editRef.args).toEqual({ slug: "imprint" });
    expect(createRef.args).toEqual({ folder: "/marketing" });
  });
});

describe("buildTarget — Compile-Time-Safety (verified via @ts-expect-error)", () => {
  // Each test pairs an @ts-expect-error block (compile-time validation
  // via TypeScript) with a runtime expectation for the corresponding
  // happy path. This provides dual coverage: the compiler checks rejection,
  // while the test checks that valid input produces the correct result.
  // Runtime behavior must be tested rather than only compile-time behavior.

  test("unbekannte action wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — "delet" is not an action of textContentStub
    buildTarget({ target: textContentStub, action: "delet" });
    const ref = buildTarget({ target: textContentStub, action: "list" });
    expect(ref.action).toBe("list");
  });

  test("falsche args-shape wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — slug must be a string, not a number
    buildTarget({ target: textContentStub, action: "edit", args: { slug: 42 } });
    // Runtime: korrekt-typed args liefern valid TargetRef
    const ref = buildTarget({
      target: textContentStub,
      action: "edit",
      args: { slug: "imprint" },
    });
    expect(ref.args).toEqual({ slug: "imprint" });
  });

  test("args bei NoArgs-Action wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — list has no args, so the args field is not allowed
    buildTarget({ target: textContentStub, action: "list", args: { x: 1 } });
    const ref = buildTarget({ target: textContentStub, action: "list" });
    expect("args" in ref).toBe(false);
  });

  test("fehlende args bei WithArgs-Action wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — edit requires args, but they are missing
    buildTarget({ target: textContentStub, action: "edit" });
    const ref = buildTarget({
      target: textContentStub,
      action: "edit",
      args: { slug: "imprint" },
    });
    expect(ref.args).toBeDefined();
  });
});
