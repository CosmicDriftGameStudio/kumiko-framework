import { describe, expect, test } from "bun:test";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { extractText, getDocumentProxy } from "unpdf";
import {
  collectRendererPlugins,
  createRendererFoundationApi,
  createRendererFoundationFeature,
  type RendererContext,
  RendererError,
} from "../../renderer-foundation/index.ts";
import { createTemplateResolverFeature } from "../../template-resolver/feature.ts";
import { createRendererPdfFeature, renderTablePdfRequest } from "../feature.ts";
import { type PdfTableDocument, renderTablePdf } from "../render-table-pdf.ts";

const TENANT = "11111111-1111-4111-8111-111111111111" as TenantId;

async function readPages(pdfBytes: Uint8Array): Promise<string[]> {
  const proxy = await getDocumentProxy(new Uint8Array(pdfBytes));
  const { text } = await extractText(proxy, { mergePages: false });
  return text;
}

function manyRowsDocument(overrides: Partial<PdfTableDocument> = {}): PdfTableDocument {
  return {
    title: "Prüfprotokoll Kessel",
    subtitle: "Zeitraum 01.01.2026 bis 31.03.2026",
    meta: [
      { label: "Anlage", value: "Heizkessel Süd" },
      { label: "Erstellt", value: "01.04.2026" },
    ],
    columns: [
      { header: "Datum" },
      { header: "Prüfer", weight: 2 },
      { header: "Kosten", align: "right" },
    ],
    rows: Array.from({ length: 80 }, (_, index) => [
      `${String(index + 1).padStart(2, "0")}.02.2026`,
      `Jürgen Weiß ${index + 1}`,
      `${index + 1},50 €`,
    ]),
    footerText: "Kumiko GmbH",
    pageLabel: "Seite {page} von {pages}",
    ...overrides,
  };
}

describe("renderTablePdf", () => {
  test("a long table spans pages, repeats the header and numbers the footer", async () => {
    const { pdfBytes, pageCount } = await renderTablePdf(manyRowsDocument());

    expect(pageCount).toBeGreaterThanOrEqual(2);
    const pages = await readPages(pdfBytes);
    expect(pages).toHaveLength(pageCount);
    const [first = "", second = ""] = pages;

    expect(first).toContain("Prüfprotokoll Kessel");
    expect(first).toContain("Zeitraum 01.01.2026 bis 31.03.2026");
    expect(first).toContain("Heizkessel Süd");
    expect(first).toContain("Jürgen Weiß 1");
    expect(first).toContain("1,50 €");
    expect(first).toContain(`Seite 1 von ${pageCount}`);
    expect(first).toContain("Kumiko GmbH");

    expect(second).toContain("Datum Prüfer Kosten");
    expect(second).not.toContain("Prüfprotokoll Kessel");
    expect(second).toContain(`Seite 2 von ${pageCount}`);
    expect(pages.join("\n")).toContain("Jürgen Weiß 80");
  });

  test("characters Helvetica cannot encode become '?', umlauts and euro stay", async () => {
    const { pdfBytes } = await renderTablePdf({
      title: "Zeichen",
      columns: [{ header: "Wert" }],
      rows: [["Pfeil → Größe ≥ 5 ✓ 10 €"]],
    });

    const [page = ""] = await readPages(pdfBytes);
    expect(page).toContain("Pfeil ? Größe ? 5 ? 10 €");
  });

  test("the same input renders byte-identical output", async () => {
    const first = await renderTablePdf(manyRowsDocument());
    const second = await renderTablePdf(manyRowsDocument());

    expect(Buffer.from(first.pdfBytes).equals(Buffer.from(second.pdfBytes))).toBe(true);
  });

  test("empty rows show the emptyText", async () => {
    const { pdfBytes, pageCount } = await renderTablePdf({
      title: "Leer",
      columns: [{ header: "Datum" }],
      rows: [],
      emptyText: "Keine Einträge im Zeitraum",
    });

    expect(pageCount).toBe(1);
    const [page = ""] = await readPages(pdfBytes);
    expect(page).toContain("Keine Einträge im Zeitraum");
  });

  test("overlong words break per character and stay inside their column", async () => {
    const longWord = "A".repeat(200);
    const { pdfBytes } = await renderTablePdf({
      title: "Umbruch",
      columns: [{ header: "Text" }, { header: "Zahl", align: "right" }],
      rows: [[longWord, "1"]],
    });

    const [page = ""] = await readPages(pdfBytes);
    expect(page.replaceAll(/\s/g, "")).toContain(longWord);
  });

  test("a row taller than a page is split instead of dropped", async () => {
    const paragraph = Array.from({ length: 400 }, (_, index) => `Zeile${index}`).join("\n");
    const { pdfBytes, pageCount } = await renderTablePdf({
      title: "Hoch",
      columns: [{ header: "Text" }],
      rows: [[paragraph]],
    });

    expect(pageCount).toBeGreaterThanOrEqual(2);
    const text = (await readPages(pdfBytes)).join("\n");
    expect(text).toContain("Zeile0");
    expect(text).toContain("Zeile399");
  });

  test("Letter format yields a different page size than A4", async () => {
    const doc = manyRowsDocument({ rows: [["01.02.2026", "Müller", "1 €"]] });
    const a4 = await renderTablePdf(doc, { format: "A4" });
    const letter = await renderTablePdf(doc, { format: "Letter" });

    expect(Buffer.from(a4.pdfBytes).equals(Buffer.from(letter.pdfBytes))).toBe(false);
  });

  test("a row with the wrong cell count throws invalid_payload", async () => {
    const attempt = renderTablePdf({
      title: "Kaputt",
      columns: [{ header: "A" }, { header: "B" }],
      rows: [["nur eine Zelle"]],
    });

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      code: "invalid_payload",
    });
  });

  test("a header that leaves no room for a row throws instead of looping", async () => {
    const attempt = renderTablePdf({
      title: "Schmal",
      columns: [
        { header: "W".repeat(150), weight: 0.01 },
        { header: "x", weight: 100 },
      ],
      rows: [["a", "b"]],
    });

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      message: "table header leaves no room for rows",
      code: "invalid_payload",
    });
  });

  test("60 columns with 60-character headers end with invalid_payload", async () => {
    const columns = Array.from({ length: 60 }, () => ({ header: "H".repeat(60) }));

    const attempt = renderTablePdf({
      title: "Breit",
      columns,
      rows: [columns.map(() => "x")],
    });

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      code: "invalid_payload",
    });
  });

  test("rows, columns and cell length above the limits are rejected as invalid_payload", async () => {
    const oneColumn = [{ header: "H" }];
    const variablesOverLimit = [
      { title: "Zeilen", columns: oneColumn, rows: Array.from({ length: 10_001 }, () => ["x"]) },
      { title: "Spalten", columns: Array.from({ length: 31 }, () => ({ header: "H" })), rows: [] },
      { title: "Zelle", columns: oneColumn, rows: [["x".repeat(5_001)]] },
    ];

    for (const variables of variablesOverLimit) {
      const attempt = renderTablePdfRequest({
        kind: "document-pdf",
        payload: { slug: "table", locale: "de", variables },
      });
      await expect(attempt).rejects.toMatchObject({
        name: RendererError.name,
        code: "invalid_payload",
      });
    }
  });

  test("renderTablePdf called directly enforces the same limits", async () => {
    const oneColumn = [{ header: "H" }];
    const overLimit = [
      { title: "Rows", columns: oneColumn, rows: Array.from({ length: 10_001 }, () => ["x"]) },
      { title: "x".repeat(20_001), columns: oneColumn, rows: [] },
      {
        title: "Meta",
        columns: oneColumn,
        rows: [],
        meta: Array.from({ length: 501 }, () => ({ label: "a", value: "b" })),
      },
      { title: "No columns", columns: [], rows: [] },
    ];

    for (const doc of overLimit) {
      await expect(renderTablePdf(doc)).rejects.toMatchObject({
        name: RendererError.name,
        code: "invalid_payload",
      });
    }
  });

  test("a very long title continues on the next pages without losing text", async () => {
    const title = Array.from({ length: 1500 }, (_, index) => `T${index}x`).join(" ");
    const { pdfBytes, pageCount } = await renderTablePdf({
      title,
      columns: [{ header: "Spalte" }],
      rows: [["Zelle"]],
    });

    expect(pageCount).toBeGreaterThanOrEqual(2);
    const text = (await readPages(pdfBytes)).join("\n");
    expect(text).toContain("T0x");
    expect(text).toContain("T1499x");
    expect(text).toContain("Spalte");
    expect(text).toContain("Zelle");
  });

  test("100 meta lines flow over pages and the table still starts with its header", async () => {
    const meta = Array.from({ length: 100 }, (_, index) => ({
      label: `Label${index}`,
      value: `Wert${index}`,
    }));
    const { pdfBytes, pageCount } = await renderTablePdf({
      title: "Meta",
      meta,
      columns: [{ header: "Spalte" }],
      rows: [["Zelle"]],
    });

    expect(pageCount).toBeGreaterThanOrEqual(2);
    const text = (await readPages(pdfBytes)).join("\n");
    expect(text).toContain("Label0");
    expect(text).toContain("Wert99");
    expect(text).toContain("Spalte");
    expect(text).toContain("Zelle");
  });

  test("Windows and old-Mac line endings break lines instead of becoming '?'", async () => {
    const { pdfBytes } = await renderTablePdf({
      title: "Zeilenenden",
      columns: [{ header: "Text" }],
      rows: [["a\r\nb"], ["c\rd"]],
    });

    const text = (await readPages(pdfBytes)).join("\n");
    expect(text).not.toContain("?");
    expect(text).toMatch(/a\s+b/);
    expect(text).toMatch(/c\s+d/);
  });

  test("negative margins throw invalid_payload", async () => {
    const attempt = renderTablePdf(
      { title: "Rand", columns: [{ header: "A" }], rows: [] },
      { marginMm: { left: -5 } },
    );

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      code: "invalid_payload",
    });
  });

  test("margins that leave under 20pt per column throw invalid_payload", async () => {
    const attempt = renderTablePdf(
      {
        title: "Rand",
        columns: [{ header: "A" }, { header: "B" }, { header: "C" }],
        rows: [],
      },
      { marginMm: { left: 100, right: 100 } },
    );

    await expect(attempt).rejects.toMatchObject({
      message: "margins leave no room for table columns",
      code: "invalid_payload",
    });
  });
});

describe("renderer-pdf plugin", () => {
  const registry = createRegistry([
    createTemplateResolverFeature(),
    createRendererFoundationFeature(),
    createRendererPdfFeature(),
  ]);
  const api = createRendererFoundationApi(collectRendererPlugins(registry));
  const ctx: RendererContext = { db: null as never, registry, tenantId: TENANT };

  test("is selected for document-pdf and renders payload.variables", async () => {
    const renderer = api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" });

    const response = await renderer.render(
      {
        kind: "document-pdf",
        payload: {
          slug: "table",
          locale: "de",
          variables: { ...manyRowsDocument({ rows: [["01.02.2026", "Müller", "1 €"]] }) },
        },
        options: { format: "Letter" },
      },
      ctx,
    );

    if (response.kind !== "document-pdf") throw new Error("expected document-pdf response");
    expect(renderer.name).toBe("pdf");
    expect(response.pageCount).toBe(1);
    expect(response.sizeBytes).toBe(response.pdfBytes.byteLength);
    expect(response.fileName).toBe("table.pdf");
    const [page = ""] = await readPages(response.pdfBytes);
    expect(page).toContain("Prüfprotokoll Kessel");
  });

  test("negative margins in the request options raise invalid_payload", async () => {
    const renderer = api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" });

    const attempt = renderer.render(
      {
        kind: "document-pdf",
        payload: {
          slug: "table",
          locale: "de",
          variables: { ...manyRowsDocument({ rows: [] }) },
        },
        options: { marginMm: { top: -1 } },
      },
      ctx,
    );

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      code: "invalid_payload",
    });
  });

  test("variables that are no table document raise invalid_payload", async () => {
    const renderer = api.createRendererForTenant({ tenantId: TENANT, kind: "document-pdf" });

    const attempt = renderer.render(
      { kind: "document-pdf", payload: { slug: "table", locale: "de", variables: { title: 5 } } },
      ctx,
    );

    await expect(attempt).rejects.toMatchObject({
      name: RendererError.name,
      code: "invalid_payload",
    });
  });
});
