import { describe, expect, test } from "bun:test";
import { templateVariable } from "@cosmicdrift/kumiko-framework/engine";
import { compileDocumentBodyToHandlebars } from "../compile-document-body";
import { applyDocumentOps, documentBlocksOf, documentOpsSchema } from "../document-ops";
import {
  parseDocumentJson,
  sanitizeDocumentHtml,
  sanitizeTemplateBody,
  serializeDocumentJson,
} from "../document-sanitizer";
import type { LayoutRegionName } from "../layout-regions";
import type { DocumentOpsKind } from "../web/constants";
import {
  documentCellStyleCss,
  documentTableCss,
  FILLED_CELL_EDGE_INSET_MM,
  resolveRowEdges,
} from "../web/document-style-css";

function replaceBody(blocks: unknown[], kind: DocumentOpsKind, region?: LayoutRegionName) {
  return applyDocumentOps({
    doc: parseDocumentJson(""),
    meta: {},
    variableSchema: {},
    kind,
    region,
    ops: documentOpsSchema.parse([{ op: "replaceBody", blocks }]),
  });
}

function htmlOf(result: ReturnType<typeof replaceBody>): string {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return serializeDocumentJson(result.doc);
}

function codesOf(result: ReturnType<typeof replaceBody>): string[] {
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}:${issue.code}`);
}

function schemaAccepts(block: unknown): boolean {
  return documentOpsSchema.safeParse([{ op: "replaceBody", blocks: [block] }]).success;
}

describe("image block: widthMm, align, bleed", () => {
  const image = { type: "image", resource: "logo", widthMm: 40, align: "right" };

  test("a PDF body keeps width and alignment as data attributes", () => {
    const html = htmlOf(replaceBody([image], "document-pdf"));
    expect(html).toContain('data-resource="logo"');
    expect(html).toContain('data-width-mm="40"');
    expect(html).toContain('data-align="right"');
  });

  test("the schema holds the width to 0.1..210 mm and the alignment to left, center, right", () => {
    expect(schemaAccepts({ ...image, widthMm: 210 })).toBe(true);
    expect(schemaAccepts({ ...image, widthMm: 0.1 })).toBe(true);
    expect(schemaAccepts({ ...image, widthMm: 0 })).toBe(false);
    expect(schemaAccepts({ ...image, widthMm: 210.5 })).toBe(false);
    expect(schemaAccepts({ ...image, align: "justify" })).toBe(false);
    expect(schemaAccepts({ ...image, bleed: "yes" })).toBe(false);
  });

  test.each(["header", "footer"] as const)("bleed is accepted in the %s of a layout", (region) => {
    const html = htmlOf(replaceBody([{ ...image, bleed: true }], "pdf-layout", region));
    expect(html).toContain("data-bleed");
  });

  test("bleed is refused in the signature region, in a PDF body and in a mail", () => {
    const bleeding = [{ type: "image", resource: "logo", bleed: true }];
    expect(codesOf(replaceBody(bleeding, "pdf-layout", "signature"))).toEqual([
      "ops.0.blocks.0.bleed:bleed_not_allowed",
    ]);
    expect(codesOf(replaceBody(bleeding, "document-pdf"))).toEqual([
      "ops.0.blocks.0.bleed:bleed_not_allowed",
    ]);
    expect(codesOf(replaceBody(bleeding, "mail"))).toContain(
      "ops.0.blocks.0.bleed:bleed_not_allowed",
    );
  });

  test("a mail refuses width and alignment as print styling", () => {
    expect(codesOf(replaceBody([image], "mail"))).toEqual([
      "ops.0.blocks.0:print_style_not_allowed",
    ]);
    const result = sanitizeTemplateBody({
      kind: "mail",
      contentFormat: "html",
      content: '<img data-resource="logo" data-width-mm="40">',
    });
    expect(result.ok).toBe(false);
  });

  test("an image without the new attributes is not treated as print styling in a mail", () => {
    const plain = [{ type: "image", resource: "logo", alt: "Logo" }];
    expect(codesOf(replaceBody(plain, "mail"))).toEqual([]);
  });

  test("the block list reads width, alignment and bleed back", () => {
    const html = htmlOf(replaceBody([{ ...image, bleed: true }], "pdf-layout", "header"));
    expect(documentBlocksOf(parseDocumentJson(html))).toEqual([
      {
        id: "b0",
        type: "image",
        resource: "logo",
        widthMm: 40,
        align: "right",
        bleed: true,
      },
    ]);
  });

  test("setResource keeps the size, alignment and bleed of the image", () => {
    const html = htmlOf(replaceBody([image], "document-pdf"));
    const result = applyDocumentOps({
      doc: parseDocumentJson(html),
      meta: {},
      variableSchema: {},
      kind: "document-pdf",
      ops: documentOpsSchema.parse([{ op: "setResource", blockId: "b0", resource: "stamp" }]),
    });
    const out = htmlOf(result);
    expect(out).toContain('data-resource="stamp"');
    expect(out).toContain('data-width-mm="40"');
    expect(out).toContain('data-align="right"');
  });
});

describe("image attributes in stored html", () => {
  test("round trip keeps valid values and drops invalid ones", () => {
    const valid = '<img data-resource="logo" data-width-mm="35.5" data-align="center">';
    expect(sanitizeDocumentHtml(valid)).toEqual({ ok: true, html: valid });
    const invalid =
      '<img data-resource="logo" data-width-mm="300" data-align="justify"><img data-resource="b" data-width-mm="0">';
    expect(sanitizeDocumentHtml(invalid)).toEqual({
      ok: true,
      html: '<img data-resource="logo"><img data-resource="b">',
    });
  });

  test("compiles to inline width and block alignment", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<img data-resource="logo" data-width-mm="40" data-align="center">',
      {},
      { resourceSrc: () => "data:image/png;base64,AA==" },
    );
    expect(compiled).toContain("width:calc(40 * var(--paper-mm,1mm))");
    expect(compiled).toContain("max-height:none");
    expect(compiled).toContain("margin-left:auto;margin-right:auto");
  });

  test("a full-bleed image gets no inline size that would override the region CSS", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<img data-resource="logo" data-bleed="" data-width-mm="40" data-align="center">',
      {},
      { resourceSrc: () => "data:image/png;base64,AA==" },
    );
    expect(compiled).not.toContain("style=");
  });
});

describe("divider: color and weightPt", () => {
  test("accepts a color and weight and keeps them in the html", () => {
    const html = htmlOf(
      replaceBody([{ type: "divider", color: "#ff6600", weightPt: 2 }], "document-pdf"),
    );
    expect(html).toBe('<hr data-color="#ff6600" data-weight-pt="2">');
  });

  test("the schema holds the weight to 0.25..4 pt and the color to #rrggbb", () => {
    expect(schemaAccepts({ type: "divider", weightPt: 0.25 })).toBe(true);
    expect(schemaAccepts({ type: "divider", weightPt: 4 })).toBe(true);
    expect(schemaAccepts({ type: "divider", weightPt: 0.2 })).toBe(false);
    expect(schemaAccepts({ type: "divider", weightPt: 4.1 })).toBe(false);
    expect(schemaAccepts({ type: "divider", color: "orange" })).toBe(false);
  });

  test("a plain divider stays a plain <hr>, also through the sanitizer", () => {
    expect(htmlOf(replaceBody([{ type: "divider" }], "document-pdf"))).toBe("<hr>");
    expect(sanitizeDocumentHtml("<hr>")).toEqual({ ok: true, html: "<hr>" });
  });

  test("stored html drops invalid values, a mail refuses valid ones", () => {
    expect(sanitizeDocumentHtml('<hr data-color="red" data-weight-pt="9">')).toEqual({
      ok: true,
      html: "<hr>",
    });
    expect(codesOf(replaceBody([{ type: "divider", color: "#ff6600" }], "mail"))).toEqual([
      "ops.0.blocks.0:print_style_not_allowed",
    ]);
  });

  test("compiles to a border with the chosen color and weight", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<hr data-color="#ff6600" data-weight-pt="2">',
      {},
    );
    expect(compiled).toContain("border:0;border-top:calc(2 * var(--paper-pt,1pt)) solid #ff6600");
  });

  test("the block list reads color and weight back", () => {
    const html = htmlOf(
      replaceBody([{ type: "divider", color: "#ff6600", weightPt: 2 }], "document-pdf"),
    );
    expect(documentBlocksOf(parseDocumentJson(html))).toEqual([
      { id: "b0", type: "divider", color: "#ff6600", weightPt: 2 },
    ]);
  });
});

describe("hardBreak run", () => {
  test("breaks a paragraph into lines that keep their own formatting", () => {
    const html = htmlOf(
      replaceBody(
        [
          {
            type: "paragraph",
            runs: [
              { text: "Beschreibung", bold: true },
              { hardBreak: true },
              { text: "Zweite Zeile", sizePt: 8, color: "#888888" },
            ],
          },
        ],
        "document-pdf",
      ),
    );
    expect(html).toBe(
      '<p><strong>Beschreibung</strong><br><span data-text-style="" data-color="#888888" data-size-pt="8">Zweite Zeile</span></p>',
    );
  });

  test("works inside a table cell and survives the sanitizer", () => {
    const html = htmlOf(
      replaceBody(
        [
          {
            type: "table",
            rows: [
              {
                cells: [{ runs: [{ text: "Position" }, { hardBreak: true }, { text: "Detail" }] }],
              },
            ],
          },
        ],
        "mail",
      ),
    );
    expect(html).toContain("<td><p>Position<br>Detail</p></td>");
    expect(sanitizeDocumentHtml(html)).toEqual({ ok: true, html });
  });

  test("reads back as a new line in the block text", () => {
    const html = htmlOf(
      replaceBody(
        [{ type: "paragraph", runs: [{ text: "A" }, { hardBreak: true }, { text: "B" }] }],
        "mail",
      ),
    );
    expect(documentBlocksOf(parseDocumentJson(html))).toEqual([
      { id: "b0", type: "paragraph", text: "A\nB" },
    ]);
  });

  test("a hard break is not a text run: it must be exactly {hardBreak:true}", () => {
    expect(schemaAccepts({ type: "paragraph", runs: [{ hardBreak: false }] })).toBe(false);
    expect(schemaAccepts({ type: "paragraph", runs: [{ hardBreak: true }] })).toBe(true);
  });
});

describe("table: rowsAfterRepeat", () => {
  const cells = (...texts: string[]) => ({ cells: texts.map((text) => ({ text })) });

  test("prints the rows after the repeat row, only the repeat row repeats", () => {
    const html = htmlOf(
      replaceBody(
        [
          {
            type: "table",
            header: cells("Position", "Preis"),
            rows: [],
            repeat: { each: "positions", row: cells("{{label}}", "{{price}}") },
            rowsAfterRepeat: [cells("Netto", "{{net}}"), cells("Brutto", "{{gross}}")],
          },
        ],
        "document-pdf",
      ),
    );
    expect(html.match(/data-each=/g)).toHaveLength(1);
    expect(html.indexOf("data-each")).toBeLessThan(html.indexOf("Netto"));
    expect(html.indexOf("Netto")).toBeLessThan(html.indexOf("Brutto"));
    expect(html.indexOf("Brutto")).toBe(html.lastIndexOf("Brutto"));
  });

  test("needs a repeat row and the same number of cells in every row", () => {
    expect(
      codesOf(
        replaceBody(
          [{ type: "table", rows: [cells("a")], rowsAfterRepeat: [cells("b")] }],
          "document-pdf",
        ),
      ),
    ).toEqual(["ops.0.blocks.0.rowsAfterRepeat:invalid_table"]);
    expect(
      codesOf(
        replaceBody(
          [
            {
              type: "table",
              rows: [],
              repeat: { each: "positions", row: cells("a", "b") },
              rowsAfterRepeat: [cells("only one")],
            },
          ],
          "document-pdf",
        ),
      ),
    ).toEqual(["ops.0.blocks.0:invalid_table"]);
  });
});

describe("table: cellPaddingMm, widthMm, align", () => {
  const cells = (...texts: string[]) => ({ cells: texts.map((text) => ({ text })) });
  const table = { type: "table", rows: [cells("a", "b")] };

  test("keeps padding, width and alignment as data attributes", () => {
    const html = htmlOf(
      replaceBody([{ ...table, cellPaddingMm: 2, widthMm: 120, align: "right" }], "document-pdf"),
    );
    expect(html).toContain('data-cell-padding-mm="2"');
    expect(html).toContain('data-table-width-mm="120"');
    expect(html).toContain('data-table-align="right"');
  });

  test("the schema holds padding to 0..10 mm, width to 0.1..210 mm and alignment to left, center, right", () => {
    expect(schemaAccepts({ ...table, cellPaddingMm: 0 })).toBe(true);
    expect(schemaAccepts({ ...table, cellPaddingMm: 10 })).toBe(true);
    expect(schemaAccepts({ ...table, cellPaddingMm: 10.1 })).toBe(false);
    expect(schemaAccepts({ ...table, cellPaddingMm: -1 })).toBe(false);
    expect(schemaAccepts({ ...table, widthMm: 0.1 })).toBe(true);
    expect(schemaAccepts({ ...table, widthMm: 210 })).toBe(true);
    expect(schemaAccepts({ ...table, widthMm: 0 })).toBe(false);
    expect(schemaAccepts({ ...table, widthMm: 211 })).toBe(false);
    expect(schemaAccepts({ ...table, align: "justify" })).toBe(false);
  });

  test("stored html drops invalid values, a mail refuses valid ones", () => {
    expect(
      sanitizeDocumentHtml(
        '<table data-cell-padding-mm="11" data-table-width-mm="0" data-table-align="top"><tbody><tr><td><p>a</p></td></tr></tbody></table>',
      ),
    ).toEqual({
      ok: true,
      html: "<table><tbody><tr><td><p>a</p></td></tr></tbody></table>",
    });
    expect(codesOf(replaceBody([{ ...table, cellPaddingMm: 2 }], "mail"))).toEqual([
      "ops.0.blocks.0:print_style_not_allowed",
    ]);
    expect(codesOf(replaceBody([{ ...table, align: "center" }], "mail"))).toEqual([
      "ops.0.blocks.0:print_style_not_allowed",
    ]);
  });

  test("compiles to padding on every cell and a width with a block placement on the table", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<table data-cell-padding-mm="2" data-table-width-mm="120" data-table-align="center"><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>',
      {},
    );
    expect(compiled).toContain("width:calc(120 * var(--paper-mm,1mm));max-width:100%");
    expect(compiled).toContain("margin-left:auto;margin-right:auto");
    expect(compiled.match(/padding-top:calc\(2 \* var\(--paper-mm,1mm\)\)/g)).toHaveLength(2);
  });
});

describe("table rows: lineAbove and lineBelow", () => {
  const dark = { color: "#112233", weightPt: 1 };
  const cells = (...texts: string[]) => ({ cells: texts.map((text) => ({ text })) });

  test("the schema holds the weight to 0.25..4 pt and the color to #rrggbb", () => {
    const withLine = (lineAbove: unknown) => ({
      type: "table",
      rows: [{ ...cells("a"), lineAbove }],
    });
    expect(schemaAccepts(withLine({ color: "#112233", weightPt: 0.25 }))).toBe(true);
    expect(schemaAccepts(withLine({ color: "#112233", weightPt: 4 }))).toBe(true);
    expect(schemaAccepts(withLine({ color: "#112233", weightPt: 0.2 }))).toBe(false);
    expect(schemaAccepts(withLine({ color: "#112233", weightPt: 4.5 }))).toBe(false);
    expect(schemaAccepts(withLine({ color: "red", weightPt: 1 }))).toBe(false);
    expect(schemaAccepts(withLine({ color: "#112233" }))).toBe(false);
  });

  test("works on the repeat row and on rows after it, and wins over the other rows' edges", () => {
    const html = htmlOf(
      replaceBody(
        [
          {
            type: "table",
            rows: [],
            repeat: { each: "positions", row: { ...cells("{{label}}"), lineBelow: dark } },
            rowsAfterRepeat: [{ ...cells("Netto"), lineAbove: { color: "#ff0000", weightPt: 2 } }],
          },
        ],
        "document-pdf",
      ),
    );
    expect(html).toContain('data-line-below="#112233 1"');
    expect(html).toContain('data-line-above="#ff0000 2"');
  });

  test("compiles to a rule on the cells of that row and mirrors it on the neighbour's facing edge", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<table><tbody><tr data-line-below="#112233 1"><td><p>a</p></td></tr><tr><td><p>b</p></td></tr></tbody></table>',
      {},
    );
    const rule = "calc(1 * var(--paper-pt,1pt)) solid #112233";
    expect(compiled).toContain(`border-bottom:${rule}`);
    expect(compiled).toContain(`border-top:${rule}`);
  });

  test("stored html drops an invalid line, a mail refuses a valid one", () => {
    expect(
      sanitizeDocumentHtml(
        '<table><tbody><tr data-line-above="red 1"><td><p>a</p></td></tr></tbody></table>',
      ),
    ).toEqual({ ok: true, html: "<table><tbody><tr><td><p>a</p></td></tr></tbody></table>" });
    expect(
      codesOf(replaceBody([{ type: "table", rows: [{ ...cells("a"), lineAbove: dark }] }], "mail")),
    ).toEqual(["ops.0.blocks.0:print_style_not_allowed"]);
  });
});

describe("filled outer cells keep an inset", () => {
  test("a cell with a background in the first and last column is not flush with its fill", () => {
    const compiled = compileDocumentBodyToHandlebars(
      '<table><tbody><tr><td data-background="#003366"><p>a</p></td><td data-background="#003366"><p>b</p></td></tr></tbody></table>',
      {},
    );
    expect(compiled).toContain("padding-left:calc(1.5875 * var(--paper-mm,1mm))");
    expect(compiled).toContain("padding-right:calc(1.5875 * var(--paper-mm,1mm))");
  });

  test("an unfilled cell keeps the flush text edge", () => {
    const compiled = compileDocumentBodyToHandlebars(
      "<table><tbody><tr><td><p>a</p></td><td><p>b</p></td></tr></tbody></table>",
      {},
    );
    expect(compiled).not.toContain("padding-left");
  });
});

describe("placeholder dateStyle", () => {
  const variableSchema = { due: templateVariable.date() };

  function paragraphWith(dateStyle: unknown, kind: DocumentOpsKind = "document-pdf") {
    return applyDocumentOps({
      doc: parseDocumentJson(""),
      meta: {},
      variableSchema,
      kind,
      ops: documentOpsSchema.parse([
        {
          op: "replaceBody",
          blocks: [{ type: "paragraph", runs: [{ text: "Fällig: {{due}}", dateStyle }] }],
        },
      ]),
    });
  }

  test("is kept on the placeholder, not on the surrounding text", () => {
    const html = htmlOf(paragraphWith("short"));
    expect(html).toContain('<span data-variable="due" data-date-style="short"></span>');
    expect(html).toContain("Fällig: ");
  });

  test("only short and long are valid", () => {
    expect(
      documentOpsSchema.safeParse([
        {
          op: "replaceBody",
          blocks: [{ type: "paragraph", runs: [{ text: "{{due}}", dateStyle: "medium" }] }],
        },
      ]).success,
    ).toBe(false);
  });

  test("compiles to the date helper with the style, long and unset stay the plain helper", () => {
    const compile = (html: string) => compileDocumentBodyToHandlebars(html, variableSchema);
    expect(compile('<p><span data-variable="due" data-date-style="short"></span></p>')).toContain(
      '{{date due dateStyle="short"}}',
    );
    expect(compile('<p><span data-variable="due"></span></p>')).toContain("{{date due}}");
    expect(compile('<p><span data-variable="due" data-date-style="weird"></span></p>')).toContain(
      "{{date due}}",
    );
  });

  test("works in a mail as well, it is not print styling", () => {
    expect(codesOf(paragraphWith("short", "mail"))).toEqual([]);
  });
});

describe("editor and PDF share the table CSS builders", () => {
  const rule = { color: "#112233", weightPt: 1 };

  test("documentCellStyleCss pads the cell, keeps unfilled outer columns flush, insets filled outer cells and draws the edge rules", () => {
    expect(
      documentCellStyleCss({
        paddingMm: 2,
        isFirstInRow: true,
        isLastInRow: false,
        edges: { top: rule, bottom: null },
      }),
    ).toBe(
      "padding-top:calc(2 * var(--paper-mm,1mm));padding-bottom:calc(2 * var(--paper-mm,1mm));padding-right:calc(2 * var(--paper-mm,1mm));border-top:calc(1 * var(--paper-pt,1pt)) solid #112233",
    );
    expect(documentCellStyleCss({ background: "#003366", isFirstInRow: true })).toContain(
      `padding-left:calc(${FILLED_CELL_EDGE_INSET_MM} * var(--paper-mm,1mm))`,
    );
    expect(documentCellStyleCss({ background: "#003366", isFirstInRow: false })).not.toContain(
      "padding",
    );
    expect(documentCellStyleCss({})).toBe("");
  });

  test("a row's own line beats the neighbour's line on the shared edge", () => {
    const other = { color: "#ff0000", weightPt: 2 };
    expect(
      resolveRowEdges([
        { lineAbove: null, lineBelow: rule },
        { lineAbove: other, lineBelow: null },
        { lineAbove: null, lineBelow: null },
      ]),
    ).toEqual([
      { top: null, bottom: rule },
      { top: other, bottom: null },
      { top: null, bottom: null },
    ]);
  });

  test("a repeat row neither takes a neighbour's line nor passes its own on", () => {
    const edges = resolveRowEdges([
      { lineAbove: null, lineBelow: rule },
      { lineAbove: null, lineBelow: null, repeats: true },
      { lineAbove: null, lineBelow: null, repeats: true },
      { lineAbove: rule, lineBelow: null },
    ]);
    expect(edges.map((edge) => edge.top)).toEqual([null, null, null, rule]);
    expect(edges.map((edge) => edge.bottom)).toEqual([rule, null, null, null]);
  });

  test("documentTableCss sets width and placement", () => {
    expect(documentTableCss({})).toBe("");
    expect(documentTableCss({ widthMm: 100, align: "right" })).toBe(
      "width:calc(100 * var(--paper-mm,1mm));max-width:100%;margin-left:auto;margin-right:0",
    );
  });
});
