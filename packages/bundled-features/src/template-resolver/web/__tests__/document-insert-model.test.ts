import { describe, expect, test } from "bun:test";
import type { Editor } from "@tiptap/core";
import { chosenNamesOf, type PanelModel, panelActionProps } from "../document-insert-model.ts";
import type { PanelKind } from "../document-tiptap-helpers.ts";

type ChainCall = { readonly method: string; readonly args: readonly unknown[] };

function fakeEditor(options: {
  readonly selectionEmpty?: boolean;
  readonly activeMarks?: string[];
}) {
  const calls: ChainCall[] = [];
  const chain: Record<string, unknown> = {};
  for (const method of [
    "focus",
    "setLink",
    "extendMarkRange",
    "unsetLink",
    "insertContent",
    "run",
  ]) {
    chain[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return chain;
    };
  }
  const editor = {
    chain: () => chain,
    isActive: (name: string) => options.activeMarks?.includes(name) ?? false,
    state: { selection: { empty: options.selectionEmpty ?? true } },
  };
  // Boundary cast: only the members the panel model reads are provided.
  return { editor: editor as unknown as Editor, calls };
}

function panelModel(kind: PanelKind, overrides: Partial<PanelModel> & { readonly editor: Editor }) {
  const closed: string[] = [];
  const errors: Array<string | null> = [];
  const model = {
    t: (key: string) => key,
    kind,
    idPrefix: "p",
    variableLabels: {},
    onClose: () => closed.push("closed"),
    href: "",
    resource: "",
    alt: "",
    buttonText: "",
    stepsText: "",
    setError: (value: string | null) => errors.push(value),
    selectable: ["invoice.url"],
    selectedName: "invoice.url",
    noVariables: false,
    ...overrides,
    // Boundary cast: rendering primitives and setters unused by the insert handlers are omitted.
  } as unknown as PanelModel;
  return { model, closed, errors };
}

const insertedContent = (calls: readonly ChainCall[]) =>
  calls.filter((call) => call.method === "insertContent").map((call) => call.args[0]);

describe("chosenNamesOf", () => {
  test("keeps the chosen name when it is selectable", () => {
    expect(chosenNamesOf("repeat", ["a", "b"], "b").selectedName).toBe("b");
  });

  test("falls back to the first selectable name", () => {
    expect(chosenNamesOf("repeat", ["a", "b"], "gone").selectedName).toBe("a");
  });

  test("drops names that are not valid references", () => {
    expect(
      chosenNamesOf("placeholder", ["ok", "__proto__", "a.constructor"], "").selectable,
    ).toEqual(["ok"]);
  });

  test("flags missing variables only for variable-bound kinds", () => {
    expect(chosenNamesOf("repeat", [], "").noVariables).toBe(true);
    expect(chosenNamesOf("link", [], "").noVariables).toBe(false);
  });
});

describe("panelActionProps", () => {
  test("offers no insert for a variable-bound kind without variables", () => {
    const { editor } = fakeEditor({});
    const { model } = panelModel("repeat", { editor, noVariables: true });
    expect(panelActionProps(model).onInsert).toBeUndefined();
  });

  test("still offers insert for a link without variables", () => {
    const { editor } = fakeEditor({});
    const { model } = panelModel("link", { editor, noVariables: true });
    expect(panelActionProps(model).onInsert).toBeDefined();
  });

  test("offers removing a link only while the cursor is in one", () => {
    const outside = fakeEditor({});
    expect(
      panelActionProps(panelModel("link", { editor: outside.editor }).model).onRemoveLink,
    ).toBeUndefined();

    const inside = fakeEditor({ activeMarks: ["link"] });
    const { model, closed } = panelModel("link", { editor: inside.editor });
    panelActionProps(model).onRemoveLink?.();
    expect(inside.calls.map((call) => call.method)).toEqual([
      "focus",
      "extendMarkRange",
      "unsetLink",
      "run",
    ]);
    expect(closed).toHaveLength(1);
  });

  test("rejects an unsafe link and reports it without closing", () => {
    const { editor, calls } = fakeEditor({});
    const { model, closed, errors } = panelModel("link", { editor, href: "javascript:alert(1)" });
    panelActionProps(model).onInsert?.();
    expect(errors).toEqual(["template-resolver.documentEditor.invalidLink"]);
    expect(closed).toHaveLength(0);
    expect(insertedContent(calls)).toEqual([]);
  });

  test("links the selection when text is selected", () => {
    const { editor, calls } = fakeEditor({ selectionEmpty: false });
    const { model, closed } = panelModel("link", { editor, href: "https://example.com" });
    panelActionProps(model).onInsert?.();
    expect(calls.find((call) => call.method === "setLink")?.args[0]).toEqual({
      href: "https://example.com",
    });
    expect(closed).toHaveLength(1);
  });

  test("extends the existing link mark when the cursor is inside one", () => {
    const { editor, calls } = fakeEditor({ activeMarks: ["link"] });
    const { model } = panelModel("link", { editor, href: "https://example.com" });
    panelActionProps(model).onInsert?.();
    expect(calls.map((call) => call.method)).toEqual([
      "focus",
      "extendMarkRange",
      "setLink",
      "run",
    ]);
  });

  test("inserts a variable node for a placeholder href", () => {
    const { editor, calls } = fakeEditor({});
    const { model } = panelModel("link", { editor, href: "{{invoice.url}}" });
    panelActionProps(model).onInsert?.();
    expect(insertedContent(calls)).toEqual([
      {
        type: "variable",
        attrs: { name: "invoice.url" },
        marks: [{ type: "link", attrs: { href: "{{invoice.url}}" } }],
      },
    ]);
  });

  test("inserts the href as linked text otherwise", () => {
    const { editor, calls } = fakeEditor({});
    const { model } = panelModel("link", { editor, href: "https://example.com" });
    panelActionProps(model).onInsert?.();
    expect(insertedContent(calls)).toEqual([
      {
        type: "text",
        text: "https://example.com",
        marks: [{ type: "link", attrs: { href: "https://example.com" } }],
      },
    ]);
  });

  test("rejects an invalid resource key and an alt text with markup", () => {
    const badKey = fakeEditor({});
    const keyCase = panelModel("image", { editor: badKey.editor, resource: "not a key!" });
    panelActionProps(keyCase.model).onInsert?.();
    expect(keyCase.errors).toEqual(["template-resolver.documentEditor.invalidResourceKey"]);

    const badAlt = fakeEditor({});
    const altCase = panelModel("image", { editor: badAlt.editor, resource: "logo", alt: "<b>" });
    panelActionProps(altCase.model).onInsert?.();
    expect(altCase.errors).toEqual(["template-resolver.documentEditor.invalidImageAlt"]);
    expect(insertedContent(badKey.calls)).toEqual([]);
    expect(insertedContent(badAlt.calls)).toEqual([]);
  });

  test("inserts an image resource, storing an empty alt as null", () => {
    const { editor, calls } = fakeEditor({});
    const { model, closed } = panelModel("image", { editor, resource: "logo", alt: "" });
    panelActionProps(model).onInsert?.();
    expect(insertedContent(calls)).toEqual([
      { type: "resource", attrs: { resource: "logo", alt: null } },
    ]);
    expect(closed).toHaveLength(1);
  });

  test("inserts a button bound to the selected variable", () => {
    const { editor, calls } = fakeEditor({});
    const { model } = panelModel("button", { editor, buttonText: "Pay now" });
    panelActionProps(model).onInsert?.();
    expect(insertedContent(calls)).toEqual([
      {
        type: "button",
        attrs: { href: "{{invoice.url}}" },
        content: [{ type: "text", text: "Pay now" }],
      },
    ]);
  });

  test("rejects steps input without a valid entry", () => {
    const { editor, calls } = fakeEditor({});
    const { model, errors } = panelModel("steps", { editor, stepsText: " , " });
    panelActionProps(model).onInsert?.();
    expect(errors).toEqual(["template-resolver.documentEditor.invalidSteps"]);
    expect(insertedContent(calls)).toEqual([]);
  });

  test("inserts steps and an images block for the selected variable", () => {
    const stepsCase = fakeEditor({});
    panelActionProps(
      panelModel("steps", { editor: stepsCase.editor, stepsText: "open=Open, done=Done" }).model,
    ).onInsert?.();
    expect(insertedContent(stepsCase.calls)).toEqual([
      {
        type: "steps",
        attrs: {
          variable: "invoice.url",
          steps: [
            { key: "open", label: "Open" },
            { key: "done", label: "Done" },
          ],
        },
      },
    ]);

    const imagesCase = fakeEditor({});
    panelActionProps(panelModel("images", { editor: imagesCase.editor }).model).onInsert?.();
    expect(insertedContent(imagesCase.calls)).toEqual([
      { type: "images", attrs: { variable: "invoice.url" } },
    ]);
  });
});
