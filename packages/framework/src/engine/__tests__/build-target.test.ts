import { describe, expect, test } from "vitest";
import { buildTarget, type TreeActionDef } from "../build-target";

// createTreeActionsStub — Test-Helper für Phase-0-Stub-Features. Das
// `const`-Generic-Modifier forciert Literal-Inference, sodass die
// Action-Namen als string-literal-Union ankommen (statt zu `string`
// widening). In V.1.1 wird der Helper überflüssig: echte defineFeature-
// Outputs haben dieselbe Shape und Tests konsumieren die direkt.
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
  test("unbekannte action wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — "delet" ist keine Action von textContentStub
    buildTarget({ target: textContentStub, action: "delet" });
  });

  test("falsche args-shape wird vom Compiler abgelehnt", () => {
    buildTarget({
      target: textContentStub,
      action: "edit",
      // @ts-expect-error — slug muss string sein, nicht number
      args: { slug: 42 },
    });
  });

  test("args bei NoArgs-Action wird vom Compiler abgelehnt", () => {
    buildTarget({
      target: textContentStub,
      action: "list",
      // @ts-expect-error — list hat keine args, args-Feld nicht erlaubt
      args: { x: 1 },
    });
  });

  test("fehlende args bei WithArgs-Action wird vom Compiler abgelehnt", () => {
    // @ts-expect-error — edit braucht args, fehlt
    buildTarget({ target: textContentStub, action: "edit" });
  });
});
