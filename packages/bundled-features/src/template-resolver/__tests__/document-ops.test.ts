import { describe, expect, test } from "bun:test";
import {
  applyDocumentOps,
  type DocumentOp,
  documentBlocksOf,
  documentOpsSchema,
} from "../document-ops.ts";
import { parseDocumentJson, serializeDocumentJson } from "../document-sanitizer.ts";

const HTML = [
  "<h2>Hallo</h2>",
  '<p>Rechnung <strong>wichtig</strong> <span data-variable="invoiceNumber"></span></p>',
  "<ul><li><p>Eins</p></li><li><p>Zwei</p></li></ul>",
  '<table><tbody><tr data-each="positions"><td><p><span data-variable="label"></span></p></td></tr></tbody></table>',
  '<img data-resource="logo" alt="Logo">',
  '<a data-button href="{{payUrl}}">Jetzt zahlen</a>',
  "<hr>",
].join("");

const doc = () => parseDocumentJson(HTML);

function apply(ops: DocumentOp[], kind: "mail" | "document-pdf" = "mail") {
  return applyDocumentOps({
    doc: doc(),
    meta: { subject: "Alt" },
    variableSchema: { invoiceNumber: { type: "text" } },
    kind,
    ops,
  });
}

function html(result: ReturnType<typeof apply>): string {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return serializeDocumentJson(result.doc);
}

function codes(result: ReturnType<typeof apply>): string[] {
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.code}`);
}

describe("template-resolver :: documentBlocksOf", () => {
  test("lists every top-level node with a stable positional id", () => {
    expect(documentBlocksOf(doc())).toEqual([
      { id: "b0", type: "heading", text: "Hallo", level: 2 },
      { id: "b1", type: "paragraph", text: "Rechnung wichtig {{invoiceNumber}}" },
      { id: "b2", type: "list", text: "Eins\nZwei" },
      { id: "b3", type: "repeat", text: "{{label}}", each: "positions" },
      { id: "b4", type: "image", resource: "logo", alt: "Logo" },
      { id: "b5", type: "button", text: "Jetzt zahlen", href: "{{payUrl}}" },
      { id: "b6", type: "divider" },
    ]);
  });
});

describe("template-resolver :: applyDocumentOps", () => {
  test("insertBlock adds blocks after an id and at the start, keeping their order", () => {
    const result = html(
      apply([
        { op: "insertBlock", after: "b1", block: { type: "paragraph", text: "A {{name}}" } },
        { op: "insertBlock", after: "b1", block: { type: "heading", level: 1, text: "B" } },
        { op: "insertBlock", after: null, block: { type: "paragraph", text: "Start" } },
      ]),
    );
    expect(result.indexOf("Start")).toBeLessThan(result.indexOf("Hallo"));
    expect(result.indexOf("Rechnung")).toBeLessThan(result.indexOf("A <span"));
    expect(result.indexOf("A <span")).toBeLessThan(result.indexOf("<h1>B</h1>"));
    expect(result).toContain('<span data-variable="name"></span>');
  });

  test("insertBlock supports image, button, divider and, for a PDF, a page break", () => {
    const mail = html(
      apply([
        { op: "insertBlock", after: "b0", block: { type: "image", resource: "banner", alt: "B" } },
        {
          op: "insertBlock",
          after: "b0",
          block: { type: "button", text: "Go", href: "{{goUrl}}" },
        },
        { op: "insertBlock", after: "b0", block: { type: "divider" } },
      ]),
    );
    expect(mail).toContain('data-resource="banner"');
    expect(mail).toContain('href="{{goUrl}}"');
    const pdf = html(
      apply([{ op: "insertBlock", after: "b0", block: { type: "pageBreak" } }], "document-pdf"),
    );
    expect(pdf).toContain("data-page-break");
  });

  test("replaceText keeps the bold mark and turns a placeholder into a chip", () => {
    const result = html(
      apply([
        { op: "replaceText", blockId: "b1", find: "wichtig", replace: "dringend {{dueDate}}" },
      ]),
    );
    expect(result).toContain("<strong>dringend </strong>");
    expect(result).toContain('<span data-variable="dueDate"></span>');
    expect(result).toContain('<span data-variable="invoiceNumber"></span>');
  });

  test("removeBlock, setResource, setMeta and setVariable apply together against the read state", () => {
    const result = apply([
      { op: "removeBlock", blockId: "b0" },
      { op: "setResource", blockId: "b4", resource: "new-logo", alt: null },
      { op: "setMeta", meta: { subject: "Neu", previewText: "Vorschau" } },
      { op: "setMeta", meta: { previewText: null } },
      { op: "setVariable", name: "payUrl", definition: { type: "link", required: true } },
      { op: "setVariable", name: "invoiceNumber", definition: null },
      { op: "removeBlock", blockId: "b1" },
    ]);
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    const out = serializeDocumentJson(result.doc);
    expect(out).not.toContain("Hallo");
    expect(out).toContain('data-resource="new-logo"');
    expect(out).not.toContain("alt=");
    expect(result.meta).toEqual({ subject: "Neu" });
    expect(result.variableSchema).toEqual({ payUrl: { type: "link", required: true } });
    expect(documentBlocksOf(result.doc)).toHaveLength(5);
  });

  test("a find across a formatting change reports text_spans_formatting, not text_not_found", () => {
    expect(
      codes(apply([{ op: "replaceText", blockId: "b1", find: "Rechnung wichtig", replace: "X" }])),
    ).toEqual(["ops.0.find:text_spans_formatting"]);
  });

  test("a find with a placeholder reports placeholder_not_replaceable", () => {
    expect(
      codes(apply([{ op: "replaceText", blockId: "b1", find: "{{invoiceNumber}}", replace: "X" }])),
    ).toEqual(["ops.0.find:placeholder_not_replaceable"]);
  });

  test("reports the failing op with its path and code", () => {
    expect(codes(apply([{ op: "removeBlock", blockId: "b99" }]))).toEqual([
      "ops.0.blockId:unknown_block",
    ]);
    expect(
      codes(apply([{ op: "replaceText", blockId: "b1", find: "gibtsnicht", replace: "x" }])),
    ).toEqual(["ops.0.find:text_not_found"]);
    expect(codes(apply([{ op: "replaceText", blockId: "b2", find: "i", replace: "x" }]))).toEqual([
      "ops.0.find:text_ambiguous",
    ]);
    expect(
      codes(
        apply(
          [{ op: "insertBlock", after: "b0", block: { type: "button", text: "x", href: "{{u}}" } }],
          "document-pdf",
        ),
      ),
    ).toEqual(["ops.0.block.type:block_not_allowed"]);
    expect(codes(apply([{ op: "setResource", blockId: "b1", resource: "x" }]))).toEqual([
      "ops.0.blockId:block_type_mismatch",
    ]);
    expect(
      codes(apply([{ op: "setVariable", name: "x", definition: { type: "nonsense" } }])),
    ).toEqual(["ops.0.definition:invalid_variable_definition"]);
    expect(
      codes(
        apply([
          { op: "removeBlock", blockId: "b0" },
          { op: "removeBlock", blockId: "b0" },
        ]),
      ),
    ).toEqual(["ops.1.blockId:block_removed"]);
  });

  test("an alignment is refused where the kind has no align block", () => {
    const op: DocumentOp = {
      op: "insertBlock",
      after: "b0",
      block: { type: "paragraph", text: "x", align: "center" },
    };
    expect(codes(apply([op]))).toEqual(["ops.0.block.align:block_not_allowed"]);
    expect(html(apply([op], "document-pdf"))).toContain('data-align="center"');
  });

  test("a meta key that reaches the prototype is refused", () => {
    const meta: Record<string, unknown> = JSON.parse('{"__proto__": {"x": 1}}');
    expect(Object.keys(meta)).toEqual(["__proto__"]);
    expect(codes(apply([{ op: "setMeta", meta }]))).toEqual(["ops.0.meta:invalid_meta_key"]);
  });

  test("block ids refer to the state that was read, not to the shifted list", () => {
    const result = html(
      apply([
        { op: "removeBlock", blockId: "b0" },
        { op: "replaceText", blockId: "b1", find: "Rechnung", replace: "X" },
        { op: "insertBlock", after: "b2", block: { type: "paragraph", text: "NEU" } },
      ]),
    );
    expect(result).not.toContain("Hallo");
    expect(result).toContain("X <strong>");
    expect(result.indexOf("Eins")).toBeLessThan(result.indexOf("NEU"));
    expect(result.indexOf("NEU")).toBeLessThan(result.indexOf("<table"));
  });

  test("the op schema refuses an empty list and more than 50 ops", () => {
    expect(documentOpsSchema.safeParse([]).success).toBe(false);
    const op = { op: "removeBlock", blockId: "b0" };
    expect(documentOpsSchema.safeParse(Array.from({ length: 51 }, () => op)).success).toBe(false);
    expect(documentOpsSchema.safeParse([op]).success).toBe(true);
  });
});
