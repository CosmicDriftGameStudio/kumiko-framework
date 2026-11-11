import { describe, expect, test } from "bun:test";
import { Editor } from "@tiptap/core";
import { createDocumentEditorExtensions } from "../document-editor-extensions.ts";
import { addPlainRowBelow } from "../document-tiptap-helpers.ts";

const labels = { placeholder: "Write", image: "Image", pageBreak: "Page break" };

function createEditor(content: string): Editor {
  return new Editor({
    element: document.createElement("div"),
    extensions: createDocumentEditorExtensions(labels),
    content,
  });
}

describe("print attributes set from the editor", () => {
  test("image width, alignment and bleed are written to the document and read back", () => {
    const editor = createEditor('<img data-resource="logo">');
    editor.commands.setNodeSelection(0);
    editor.chain().updateAttributes("resource", { widthMm: 40, align: "right", bleed: true }).run();
    const html = editor.getHTML();
    expect(html).toContain('data-width-mm="40"');
    expect(html).toContain('data-align="right"');
    expect(html).toContain("data-bleed");
    const reloaded = createEditor(html);
    expect(reloaded.getHTML()).toBe(html);
    editor.chain().updateAttributes("resource", { widthMm: null, align: null }).run();
    expect(editor.getHTML()).toBe('<img data-resource="logo" data-bleed="">');
  });

  test("divider colour and weight are written to the document", () => {
    const editor = createEditor("<hr>");
    editor.commands.setNodeSelection(0);
    editor.chain().updateAttributes("divider", { color: "#ff6600", weightPt: 2 }).run();
    expect(editor.getHTML()).toBe('<hr data-color="#ff6600" data-weight-pt="2">');
  });

  test("a placeholder's date format is written to the node, shown on its chip and read back", () => {
    const editor = createEditor('<p><span data-variable="due"></span></p>');
    editor.commands.setNodeSelection(1);
    editor.chain().updateAttributes("variable", { dateStyle: "short" }).run();
    const html = editor.getHTML();
    expect(html).toBe('<p><span data-variable="due" data-date-style="short"></span></p>');
    expect(
      editor.view.dom.querySelector("[data-variable-chip]")?.getAttribute("data-date-style"),
    ).toBe("short");
    expect(createEditor(html).getHTML()).toBe(html);
    editor.commands.setNodeSelection(1);
    editor.chain().updateAttributes("variable", { dateStyle: null }).run();
    expect(editor.getHTML()).toBe('<p><span data-variable="due"></span></p>');
  });

  test("a hard break in a paragraph and in a table cell survives load and save", () => {
    const body = "<p>a<br>b</p>";
    const table = "<table><tbody><tr><td><p>a<br>b</p></td></tr></tbody></table>";
    expect(createEditor(body).getHTML()).toBe(body);
    expect(createEditor(table).getHTML()).toBe(table);
    const editor = createEditor("<p>ab</p>");
    editor.commands.setTextSelection(2);
    editor.commands.setHardBreak();
    expect(editor.getHTML()).toBe("<p>a<br>b</p>");
  });

  test("a row added under the repeat row is a plain row and is saved after it", () => {
    const body =
      '<table><tbody><tr data-each="lines" data-repeat-header=""><td><p>x</p></td></tr></tbody></table>';
    const editor = createEditor(body);
    editor.commands.setTextSelection(5);
    addPlainRowBelow(editor);
    const html = editor.getHTML();
    expect(html.startsWith('<table><tbody><tr data-each="lines" data-repeat-header="">')).toBe(
      true,
    );
    expect(html.match(/data-each/g)).toHaveLength(1);
    expect(html.match(/<tr/g)).toHaveLength(2);
    expect(createEditor(html).getHTML()).toBe(html);
  });
});
