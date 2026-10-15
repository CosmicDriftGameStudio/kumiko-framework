import { describe, expect, test } from "bun:test";
import { Editor, getSchema } from "@tiptap/core";
import { documentBodyFixture } from "../../__tests__/document-body-fixture.js";
import { sanitizeDocumentHtml } from "../../document-sanitizer.js";
import { documentExtensions } from "../../document-schema.js";
import { createDocumentEditorExtensions } from "../document-editor-extensions.js";

const labels = { placeholder: "Write", image: "Image", pageBreak: "Page break" };

function createEditor(content?: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createDocumentEditorExtensions(labels),
    ...(content !== undefined && { content }),
  });
}

const CANONICAL_BODIES: readonly (readonly [string, string])[] = [
  ["variable", '<p><span data-variable="a.b"></span></p>'],
  ["resource with alt", '<img data-resource="logo" alt="Logo">'],
  ["resource without alt", '<img data-resource="logo">'],
  ["button", '<a data-button="" href="{{u}}">Go</a>'],
  ["link", '<p><a href="https://example.org">x</a></p>'],
  ["divider", "<hr>"],
  ["page break", '<div data-page-break=""></div>'],
  [
    "table with header",
    "<table><tbody><tr><th><p>A</p></th></tr><tr><td><p>b</p></td></tr></tbody></table>",
  ],
  [
    "repeat row",
    '<table><tbody><tr data-each="lines" data-repeat-header=""><td><p></p></td></tr></tbody></table>',
  ],
  ["headings", "<h1>a</h1><h2>b</h2><h3>c</h3>"],
  ["lists", "<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>"],
  ["bold and italic", "<p><strong>b</strong><em>i</em></p>"],
];

function expectRoundtrip(body: string): void {
  const sanitized = sanitizeDocumentHtml(body);
  expect(sanitized).toEqual({ ok: true, html: body });

  const viaConstructor = createEditor(body);
  expect(viaConstructor.getHTML()).toBe(body);
  viaConstructor.destroy();

  const viaSetContent = createEditor();
  viaSetContent.commands.setContent(body, { emitUpdate: false });
  expect(viaSetContent.getHTML()).toBe(body);
  viaSetContent.destroy();
}

describe("document editor extensions", () => {
  test("schema has the same nodes, marks and node attributes as the server schema", () => {
    const editorSchema = getSchema(createDocumentEditorExtensions(labels));
    const serverSchema = getSchema(documentExtensions);
    expect(Object.keys(editorSchema.nodes).sort()).toEqual(Object.keys(serverSchema.nodes).sort());
    expect(Object.keys(editorSchema.marks).sort()).toEqual(Object.keys(serverSchema.marks).sort());
    for (const [name, nodeType] of Object.entries(serverSchema.nodes)) {
      expect(Object.keys(editorSchema.nodes[name]?.spec.attrs ?? {}).sort()).toEqual(
        Object.keys(nodeType.spec.attrs ?? {}).sort(),
      );
    }
  });

  test("the full fixture survives the editor unchanged and is canonical for the sanitizer", () => {
    expectRoundtrip(documentBodyFixture);
  });

  test.each(CANONICAL_BODIES)("%s survives the editor unchanged", (_name, body) => {
    expectRoundtrip(body);
  });
});
