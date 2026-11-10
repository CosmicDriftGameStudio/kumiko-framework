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

const PDF = "document-pdf" as const;
const ADDRESS_FRAME = {
  type: "frame",
  xMm: 20,
  yMm: 45,
  widthMm: 85,
  heightMm: 45,
  preset: "address",
  blocks: [{ type: "paragraph", text: "Musterfirma GmbH" }],
} as const;

function replaceBody(blocks: unknown[], kind: "mail" | "document-pdf" | "pdf-layout" = PDF) {
  const parsed = documentOpsSchema.parse([{ op: "replaceBody", blocks }]);
  return applyDocumentOps({ doc: doc(), meta: {}, variableSchema: {}, kind, ops: parsed });
}

describe("template-resolver :: structured blocks", () => {
  test("runs carry bold, italic, underline and a text style, placeholders stay chips", () => {
    const out = html(
      replaceBody([
        {
          type: "paragraph",
          runs: [
            { text: "Fett ", bold: true },
            {
              text: "Groß {{name}}",
              italic: true,
              underline: true,
              sizePt: 14,
              color: "#112233",
              font: "times",
            },
          ],
        },
      ]),
    );
    expect(out).toContain("<strong>Fett </strong>");
    expect(out).toContain('data-size-pt="14"');
    expect(out).toContain('data-color="#112233"');
    expect(out).toContain('data-font="times"');
    expect(out).toContain('<span data-variable="name"></span>');
  });

  test("text and runs together, or neither, are refused", () => {
    expect(codes(replaceBody([{ type: "paragraph", text: "a", runs: [{ text: "b" }] }]))).toEqual([
      "ops.0.blocks.0:text_or_runs_required",
    ]);
    expect(codes(replaceBody([{ type: "paragraph" }]))).toEqual([
      "ops.0.blocks.0:text_or_runs_required",
    ]);
  });

  test("block formatting lands on paragraph and heading", () => {
    const out = html(
      replaceBody([
        {
          type: "heading",
          level: 2,
          text: "Titel",
          align: "center",
          style: { lineHeight: 1.5, spaceBeforePt: 6, spaceAfterPt: 12 },
          textStyle: { font: "arial", sizePt: 20 },
        },
      ]),
    );
    expect(out).toContain('data-align="center"');
    expect(out).toContain('data-line-height="1.5"');
    expect(out).toContain('data-space-before="6"');
    expect(out).toContain('data-space-after="12"');
    expect(out).toContain('data-size-pt="20"');
  });

  test("a list is ordered or bullet and takes strings or runs as items", () => {
    const ordered = html(
      replaceBody([
        { type: "list", ordered: true, items: ["Eins", [{ text: "Zwei", bold: true }]] },
      ]),
    );
    expect(ordered).toContain("<ol>");
    expect(ordered).toContain("<strong>Zwei</strong>");
    expect(html(replaceBody([{ type: "list", ordered: false, items: ["Eins"] }]))).toContain(
      "<ul>",
    );
  });

  test("a table has a repeating header, a repeat row, borders, widths and cell backgrounds", () => {
    const out = html(
      replaceBody([
        {
          type: "table",
          borders: "none",
          columnWidthsPx: [200, 100],
          header: {
            cells: [
              { text: "Posten", background: "#eeeeee" },
              { text: "Preis", align: "right" },
            ],
          },
          rows: [{ cells: [{ text: "Summe" }, { text: "{{total}}" }] }],
          repeat: {
            each: "positions",
            row: { cells: [{ text: "{{label}}" }, { text: "{{price}}" }] },
          },
        },
      ]),
    );
    expect(out).toContain('data-borders="none"');
    expect(out).toContain("data-repeat-header");
    expect(out).toContain('data-each="positions"');
    expect(out).toContain('data-background="#eeeeee"');
    expect(out).toContain('data-colwidth="200"');
    expect(out).toContain("<th");
  });

  test("table refusals: ragged rows, widths that do not match, an empty table, a bad repeat name", () => {
    const row2 = { cells: [{ text: "a" }, { text: "b" }] };
    const row1 = { cells: [{ text: "a" }] };
    expect(codes(replaceBody([{ type: "table", rows: [row2, row1] }]))).toEqual([
      "ops.0.blocks.0:invalid_table",
    ]);
    expect(codes(replaceBody([{ type: "table", rows: [row2], columnWidthsPx: [10] }]))).toContain(
      "ops.0.blocks.0.rows.0.cells:invalid_table",
    );
    expect(codes(replaceBody([{ type: "table", rows: [] }]))).toEqual([
      "ops.0.blocks.0:invalid_table",
    ]);
    expect(
      codes(replaceBody([{ type: "table", rows: [row1], repeat: { each: "no good", row: row1 } }])),
    ).toEqual(["ops.0.blocks.0.repeat.each:invalid_repeat_variable"]);
  });

  test("a frame keeps its position, preset and inner blocks", () => {
    const out = html(replaceBody([ADDRESS_FRAME]));
    expect(out).toContain("data-frame");
    expect(out).toContain('data-x="20"');
    expect(out).toContain('data-frame-preset="address"');
    expect(out).toContain("Musterfirma GmbH");
    const applied = replaceBody([ADDRESS_FRAME]);
    if (!applied.ok) throw new Error(JSON.stringify(applied.issues));
    const blocks = documentBlocksOf(applied.doc);
    expect(blocks[0]).toMatchObject({
      type: "frame",
      text: "Musterfirma GmbH",
      frame: { xMm: 20, yMm: 45, widthMm: 85, heightMm: 45, preset: "address" },
    });
  });

  test("a frame is refused in a mail and in a layout region", () => {
    expect(codes(replaceBody([ADDRESS_FRAME], "mail"))).toContain(
      "ops.0.blocks.0.type:block_not_allowed",
    );
    expect(codes(replaceBody([ADDRESS_FRAME], "pdf-layout"))).toContain(
      "ops.0.blocks.0.type:block_not_allowed",
    );
  });

  test("print styling is refused in a mail", () => {
    expect(
      codes(replaceBody([{ type: "paragraph", text: "x", style: { lineHeight: 2 } }], "mail")),
    ).toEqual(["ops.0.blocks.0:print_style_not_allowed"]);
    expect(
      codes(replaceBody([{ type: "paragraph", runs: [{ text: "x", color: "#000000" }] }], "mail")),
    ).toEqual(["ops.0.blocks.0:print_style_not_allowed"]);
    expect(
      codes(
        replaceBody(
          [{ type: "table", rows: [{ cells: [{ text: "x", background: "#ffffff" }] }] }],
          "mail",
        ),
      ),
    ).toEqual(["ops.0.blocks.0:print_style_not_allowed"]);
  });

  test("replaceBody replaces everything and old ids are gone afterwards", () => {
    const ops = documentOpsSchema.parse([
      { op: "replaceBody", blocks: [{ type: "paragraph", text: "Neu" }] },
      { op: "removeBlock", blockId: "b0" },
    ]);
    expect(
      codes(applyDocumentOps({ doc: doc(), meta: {}, variableSchema: {}, kind: PDF, ops })),
    ).toEqual(["ops.1.blockId:block_removed"]);
    const out = html(replaceBody([{ type: "paragraph", text: "Neu" }]));
    expect(out).toBe("<p>Neu</p>");
  });

  test("replaceBody counts blocks inside frames against the limit of 300", () => {
    const inner = { type: "paragraph", text: "x" };
    const frames = Array.from({ length: 100 }, () => ({
      ...ADDRESS_FRAME,
      blocks: [inner, inner, inner],
    }));
    expect(documentOpsSchema.safeParse([{ op: "replaceBody", blocks: frames }]).success).toBe(true);
    expect(codes(replaceBody(frames))).toEqual(["ops.0.blocks:too_many_blocks"]);
    const tooManyTop = Array.from({ length: 301 }, () => inner);
    expect(documentOpsSchema.safeParse([{ op: "replaceBody", blocks: tooManyTop }]).success).toBe(
      false,
    );
  });

  test("the schema refuses values outside the print ranges, fonts, colors and presets", () => {
    const parse = (block: unknown) =>
      documentOpsSchema.safeParse([{ op: "replaceBody", blocks: [block] }]).success;
    expect(parse({ type: "paragraph", text: "x", style: { lineHeight: 9 } })).toBe(false);
    expect(parse({ type: "paragraph", runs: [{ text: "x", sizePt: 2 }] })).toBe(false);
    expect(parse({ type: "paragraph", runs: [{ text: "x", font: "comic-sans" }] })).toBe(false);
    expect(parse({ type: "paragraph", runs: [{ text: "x", color: "red" }] })).toBe(false);
    expect(parse({ ...ADDRESS_FRAME, preset: "banner" })).toBe(false);
    expect(parse({ ...ADDRESS_FRAME, xMm: 5000 })).toBe(false);
    expect(parse({ ...ADDRESS_FRAME, blocks: [ADDRESS_FRAME] })).toBe(false);
    expect(parse({ type: "table", columnWidthsPx: [0], rows: [] })).toBe(false);
  });

  test("formatBlock formats a paragraph and a list, keeping the other settings", () => {
    const ops = documentOpsSchema.parse([
      {
        op: "formatBlock",
        blockId: "b1",
        align: "right",
        textStyle: { sizePt: 12, color: "#ff0000" },
      },
      { op: "formatBlock", blockId: "b2", style: { spaceAfterPt: 8 } },
    ]);
    const out = html(
      applyDocumentOps({ doc: doc(), meta: {}, variableSchema: {}, kind: PDF, ops }),
    );
    expect(out).toContain('data-align="right"');
    expect(out).toContain('data-size-pt="12"');
    expect(out).toContain("<strong>");
    expect(out).toContain('data-space-after="8"');
  });

  test("formatBlock refuses an empty format, a wrong block, and print styling in a mail", () => {
    const run = (op: unknown, kind: "mail" | "document-pdf" = PDF) =>
      codes(
        applyDocumentOps({
          doc: doc(),
          meta: {},
          variableSchema: {},
          kind,
          ops: documentOpsSchema.parse([op]),
        }),
      );
    expect(run({ op: "formatBlock", blockId: "b1" })).toEqual(["ops.0:empty_format"]);
    expect(run({ op: "formatBlock", blockId: "b4", align: "left" })).toEqual([
      "ops.0.blockId:block_type_mismatch",
    ]);
    expect(run({ op: "formatBlock", blockId: "b1", style: { lineHeight: 2 } }, "mail")).toEqual([
      "ops.0:print_style_not_allowed",
    ]);
  });

  test("a layout region takes tables and text but follows the PDF set", () => {
    const out = html(
      replaceBody(
        [{ type: "table", borders: "none", rows: [{ cells: [{ text: "{{companyIban}}" }] }] }],
        "pdf-layout",
      ),
    );
    expect(out).toContain('data-borders="none"');
  });
});
