import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import * as z from "zod";
import { RendererError } from "../renderer-foundation/index.ts";
import type { PdfPageFormat } from "../template-resolver/index.ts";

// Upper bounds keep a hostile or runaway payload from exhausting memory and CPU in layout.
const PDF_TABLE_MAX_ROWS = 10_000;
const PDF_TABLE_MAX_COLUMNS = 30;
const PDF_TABLE_MAX_CELL_LENGTH = 5_000;
const PDF_TABLE_MAX_META_ENTRIES = 500;
const PDF_TABLE_MAX_TEXT_LENGTH = 20_000;
const PDF_TABLE_MAX_PAGE_LABEL_LENGTH = 100;

const pdfTableColumnSchema = z
  .object({
    header: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH),
    weight: z.number().positive().optional(),
    align: z.enum(["left", "right"]).optional(),
  })
  .readonly();

export const pdfTableDocumentSchema = z
  .object({
    title: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH),
    subtitle: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH).optional(),
    meta: z
      .array(
        z
          .object({
            label: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH),
            value: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH),
          })
          .readonly(),
      )
      .max(PDF_TABLE_MAX_META_ENTRIES)
      .readonly()
      .optional(),
    columns: z.array(pdfTableColumnSchema).min(1).max(PDF_TABLE_MAX_COLUMNS).readonly(),
    rows: z
      .array(z.array(z.string().max(PDF_TABLE_MAX_CELL_LENGTH)).readonly())
      .max(PDF_TABLE_MAX_ROWS)
      .readonly(),
    emptyText: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH).optional(),
    footerText: z.string().max(PDF_TABLE_MAX_TEXT_LENGTH).optional(),
    // Template with `{page}` and `{pages}`; default `"{page} / {pages}"`.
    pageLabel: z.string().max(PDF_TABLE_MAX_PAGE_LABEL_LENGTH).optional(),
  })
  .readonly();

export type PdfTableColumn = z.infer<typeof pdfTableColumnSchema>;
export type PdfTableDocument = z.infer<typeof pdfTableDocumentSchema>;

const marginMmSchema = z
  .object({
    top: z.number().nonnegative().optional(),
    right: z.number().nonnegative().optional(),
    bottom: z.number().nonnegative().optional(),
    left: z.number().nonnegative().optional(),
  })
  .readonly();

export type PdfTableOptions = {
  readonly format?: PdfPageFormat;
  readonly marginMm?: z.input<typeof marginMmSchema>;
};

export type PdfTableResult = { readonly pdfBytes: Uint8Array; readonly pageCount: number };

const POINTS_PER_MM = 72 / 25.4;
const PAGE_SIZE_POINTS = {
  A4: { width: 595.28, height: 841.89 },
  Letter: { width: 612, height: 792 },
} as const satisfies Record<PdfPageFormat, { readonly width: number; readonly height: number }>;
const DEFAULT_MARGIN_MM = { top: 18, right: 15, bottom: 18, left: 15 } as const;

const TITLE_SIZE = 16;
const SUBTITLE_SIZE = 11;
const BODY_SIZE = 9;
const FOOTER_SIZE = 8;
const LINE_HEIGHT_FACTOR = 1.3;
const CELL_PADDING_X = 4;
const CELL_PADDING_Y = 3;
const FOOTER_RESERVE = 16;
const MIN_COLUMN_WIDTH = 20;
const META_LABEL_GAP = 10;
const BLOCK_GAP = 10;
const REPLACEMENT_CHAR = "?";
const ELLIPSIS = "...";

const TEXT_COLOR = rgb(0.1, 0.1, 0.1);
const MUTED_COLOR = rgb(0.4, 0.4, 0.4);
const HEADER_FILL = rgb(0.92, 0.93, 0.95);
const RULE_COLOR = rgb(0.8, 0.8, 0.82);

type Fonts = { readonly regular: PDFFont; readonly bold: PDFFont };

function lineHeightFor(size: number): number {
  return size * LINE_HEIGHT_FACTOR;
}

function createEncodableText(font: PDFFont): (text: string) => string {
  const supported = new Set(font.getCharacterSet());
  return (text) => {
    let result = "";
    for (const char of text.replace(/\r\n?/g, "\n").replace(/\t/g, " ")) {
      const codePoint = char.codePointAt(0) ?? 0;
      result += codePoint === 0x0a || supported.has(codePoint) ? char : REPLACEMENT_CHAR;
    }
    return result;
  };
}

function breakLongWord(word: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const char of word) {
    if (current !== "" && font.widthOfTextAtSize(current + char, size) > maxWidth) {
      pieces.push(current);
      current = char;
    } else {
      current += char;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\r\n|\n|\r/)) {
    let current = "";
    for (const word of paragraph.split(" ").filter((w) => w !== "")) {
      const candidate = current === "" ? word : `${current} ${word}`;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current !== "") lines.push(current);
      const pieces =
        font.widthOfTextAtSize(word, size) <= maxWidth
          ? [word]
          : breakLongWord(word, font, size, maxWidth);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? "";
    }
    lines.push(current);
  }
  return lines;
}

function fitSingleLine(text: string, font: PDFFont, size: number, maxWidth: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let fitted = text;
  while (fitted !== "" && font.widthOfTextAtSize(fitted + ELLIPSIS, size) > maxWidth) {
    fitted = fitted.slice(0, -1);
  }
  return fitted + ELLIPSIS;
}

function resolveColumnWidths(columns: readonly PdfTableColumn[], totalWidth: number): number[] {
  const totalWeight = columns.reduce((sum, column) => sum + (column.weight ?? 1), 0);
  return columns.map((column) => (totalWidth * (column.weight ?? 1)) / totalWeight);
}

function assertRowShape(doc: PdfTableDocument): void {
  doc.rows.forEach((row, index) => {
    if (row.length !== doc.columns.length) {
      throw new RendererError(
        `row ${index} has ${row.length} cells but the table has ${doc.columns.length} columns`,
        "invalid_payload",
      );
    }
  });
}

type TableLayout = {
  readonly pageSize: { readonly width: number; readonly height: number };
  readonly margin: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  readonly contentWidth: number;
  readonly contentBottom: number;
  readonly columnWidths: readonly number[];
  readonly bodyLineHeight: number;
  readonly headerLines: readonly (readonly string[])[];
  readonly headerHeight: number;
};

function resolveTableLayout(
  doc: PdfTableDocument,
  options: PdfTableOptions | undefined,
  fonts: Fonts,
  clean: (text: string) => string,
): TableLayout {
  const marginMm = marginMmSchema.safeParse(options?.marginMm ?? {});
  if (!marginMm.success) {
    throw new RendererError("margins must be non-negative numbers", "invalid_payload");
  }
  const pageSize = PAGE_SIZE_POINTS[options?.format ?? "A4"];
  const margin = {
    top: (marginMm.data.top ?? DEFAULT_MARGIN_MM.top) * POINTS_PER_MM,
    right: (marginMm.data.right ?? DEFAULT_MARGIN_MM.right) * POINTS_PER_MM,
    bottom: (marginMm.data.bottom ?? DEFAULT_MARGIN_MM.bottom) * POINTS_PER_MM,
    left: (marginMm.data.left ?? DEFAULT_MARGIN_MM.left) * POINTS_PER_MM,
  };
  const contentWidth = pageSize.width - margin.left - margin.right;
  if (contentWidth < MIN_COLUMN_WIDTH * doc.columns.length) {
    throw new RendererError("margins leave no room for table columns", "invalid_payload");
  }
  const contentBottom = margin.bottom + FOOTER_RESERVE;
  const columnWidths = resolveColumnWidths(doc.columns, contentWidth);
  const bodyLineHeight = lineHeightFor(BODY_SIZE);

  const rowSpaceOnEmptyPage = pageSize.height - margin.top - contentBottom;
  if (rowSpaceOnEmptyPage < 4 * bodyLineHeight) {
    throw new RendererError("margins leave no room for table rows", "invalid_payload");
  }

  const headerLines = doc.columns.map((column, index) =>
    wrapText(
      clean(column.header),
      fonts.bold,
      BODY_SIZE,
      (columnWidths[index] ?? contentWidth) - 2 * CELL_PADDING_X,
    ),
  );
  const headerHeight =
    Math.max(...headerLines.map((lines) => lines.length)) * bodyLineHeight + 2 * CELL_PADDING_Y;
  // A header this tall would leave every continuation page without room for a row.
  if (rowSpaceOnEmptyPage - headerHeight < bodyLineHeight + 2 * CELL_PADDING_Y) {
    throw new RendererError("table header leaves no room for rows", "invalid_payload");
  }
  return {
    pageSize,
    margin,
    contentWidth,
    contentBottom,
    columnWidths,
    bodyLineHeight,
    headerLines,
    headerHeight,
  };
}

export async function renderTablePdf(
  untrustedDoc: PdfTableDocument,
  options?: PdfTableOptions,
): Promise<PdfTableResult> {
  // Direct callers bypass renderTablePdfRequest, so the size caps are enforced here too.
  const parsed = pdfTableDocumentSchema.safeParse(untrustedDoc);
  if (!parsed.success) {
    throw new RendererError(
      `table document is invalid: ${parsed.error.message}`,
      "invalid_payload",
    );
  }
  const doc = parsed.data;
  assertRowShape(doc);

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const fonts: Fonts = {
    regular: await pdf.embedFont(StandardFonts.Helvetica),
    bold: await pdf.embedFont(StandardFonts.HelveticaBold),
  };
  const clean = createEncodableText(fonts.regular);

  const {
    pageSize,
    margin,
    contentWidth,
    contentBottom,
    columnWidths,
    bodyLineHeight,
    headerLines,
    headerHeight,
  } = resolveTableLayout(doc, options, fonts, clean);

  let page: PDFPage = pdf.addPage([pageSize.width, pageSize.height]);
  let cursorY = pageSize.height - margin.top;

  function drawLines(
    lines: readonly string[],
    font: PDFFont,
    size: number,
    left: number,
    width: number,
    topY: number,
    align: "left" | "right",
    color = TEXT_COLOR,
  ): void {
    lines.forEach((line, index) => {
      const lineWidth = font.widthOfTextAtSize(line, size);
      const x = align === "right" ? left + width - lineWidth : left;
      page.drawText(line, {
        x,
        y: topY - size - index * lineHeightFor(size),
        size,
        font,
        color,
      });
    });
  }

  function startBlankPage(): void {
    page = pdf.addPage([pageSize.width, pageSize.height]);
    cursorY = pageSize.height - margin.top;
  }

  function ensureRoom(height: number): void {
    if (cursorY - height < contentBottom) startBlankPage();
  }

  // Line by line, so a block taller than one page continues on the next.
  function flowLines(
    lines: readonly string[],
    font: PDFFont,
    size: number,
    left: number,
    width: number,
    color = TEXT_COLOR,
  ): void {
    const lineHeight = lineHeightFor(size);
    for (const line of lines) {
      ensureRoom(lineHeight);
      drawLines([line], font, size, left, width, cursorY, "left", color);
      cursorY -= lineHeight;
    }
  }

  function drawIntroBlock(): void {
    flowLines(
      wrapText(clean(doc.title), fonts.bold, TITLE_SIZE, contentWidth),
      fonts.bold,
      TITLE_SIZE,
      margin.left,
      contentWidth,
    );

    if (doc.subtitle !== undefined) {
      flowLines(
        wrapText(clean(doc.subtitle), fonts.regular, SUBTITLE_SIZE, contentWidth),
        fonts.regular,
        SUBTITLE_SIZE,
        margin.left,
        contentWidth,
        MUTED_COLOR,
      );
    }

    const meta = doc.meta ?? [];
    if (meta.length > 0) {
      cursorY -= BLOCK_GAP / 2;
      const labels = meta.map((entry) => clean(entry.label));
      const labelWidth =
        Math.max(...labels.map((label) => fonts.bold.widthOfTextAtSize(label, BODY_SIZE))) +
        META_LABEL_GAP;
      meta.forEach((entry, index) => {
        const valueLines = wrapText(
          clean(entry.value),
          fonts.regular,
          BODY_SIZE,
          contentWidth - labelWidth,
        );
        ensureRoom(bodyLineHeight);
        drawLines(
          [labels[index] ?? ""],
          fonts.bold,
          BODY_SIZE,
          margin.left,
          labelWidth,
          cursorY,
          "left",
        );
        flowLines(
          valueLines,
          fonts.regular,
          BODY_SIZE,
          margin.left + labelWidth,
          contentWidth - labelWidth,
        );
      });
    }
    cursorY -= BLOCK_GAP;
  }

  function drawTableHeader(): void {
    page.drawRectangle({
      x: margin.left,
      y: cursorY - headerHeight,
      width: contentWidth,
      height: headerHeight,
      color: HEADER_FILL,
    });
    let x = margin.left;
    doc.columns.forEach((column, index) => {
      const width = columnWidths[index] ?? 0;
      drawLines(
        headerLines[index] ?? [],
        fonts.bold,
        BODY_SIZE,
        x + CELL_PADDING_X,
        width - 2 * CELL_PADDING_X,
        cursorY - CELL_PADDING_Y,
        column.align ?? "left",
      );
      x += width;
    });
    cursorY -= headerHeight;
  }

  function startContinuationPage(): void {
    page = pdf.addPage([pageSize.width, pageSize.height]);
    cursorY = pageSize.height - margin.top;
    drawTableHeader();
  }

  function drawRowSlice(
    cellLines: readonly (readonly string[])[],
    from: number,
    count: number,
  ): void {
    const height = count * bodyLineHeight + 2 * CELL_PADDING_Y;
    let x = margin.left;
    doc.columns.forEach((column, index) => {
      const width = columnWidths[index] ?? 0;
      drawLines(
        (cellLines[index] ?? []).slice(from, from + count),
        fonts.regular,
        BODY_SIZE,
        x + CELL_PADDING_X,
        width - 2 * CELL_PADDING_X,
        cursorY - CELL_PADDING_Y,
        column.align ?? "left",
      );
      x += width;
    });
    page.drawLine({
      start: { x: margin.left, y: cursorY - height },
      end: { x: margin.left + contentWidth, y: cursorY - height },
      thickness: 0.5,
      color: RULE_COLOR,
    });
    cursorY -= height;
  }

  function drawRow(cellLines: readonly (readonly string[])[]): void {
    const lineCount = Math.max(...cellLines.map((lines) => lines.length));
    const rowHeight = lineCount * bodyLineHeight + 2 * CELL_PADDING_Y;
    const emptyPageSpace = pageSize.height - margin.top - headerHeight - contentBottom;

    if (rowHeight > cursorY - contentBottom && rowHeight <= emptyPageSpace) {
      startContinuationPage();
    }
    let drawn = 0;
    while (drawn < lineCount) {
      const fitting = Math.floor((cursorY - contentBottom - 2 * CELL_PADDING_Y) / bodyLineHeight);
      if (fitting < 1) {
        startContinuationPage();
        continue;
      }
      const count = Math.min(fitting, lineCount - drawn);
      drawRowSlice(cellLines, drawn, count);
      drawn += count;
    }
  }

  drawIntroBlock();
  ensureRoom(headerHeight + bodyLineHeight + 2 * CELL_PADDING_Y);
  drawTableHeader();

  if (doc.rows.length === 0 && doc.emptyText !== undefined) {
    drawRow([
      wrapText(clean(doc.emptyText), fonts.regular, BODY_SIZE, contentWidth - 2 * CELL_PADDING_X),
    ]);
  }
  for (const row of doc.rows) {
    drawRow(
      row.map((cell, index) =>
        wrapText(
          clean(cell),
          fonts.regular,
          BODY_SIZE,
          (columnWidths[index] ?? contentWidth) - 2 * CELL_PADDING_X,
        ),
      ),
    );
  }

  const pages = pdf.getPages();
  const pageLabelTemplate = doc.pageLabel ?? "{page} / {pages}";
  const footerBaseline = margin.bottom;
  pages.forEach((footerPage, index) => {
    const label = clean(
      pageLabelTemplate
        .replaceAll("{page}", String(index + 1))
        .replaceAll("{pages}", String(pages.length)),
    );
    const labelWidth = fonts.regular.widthOfTextAtSize(label, FOOTER_SIZE);
    if (doc.footerText !== undefined) {
      footerPage.drawText(
        fitSingleLine(
          clean(doc.footerText.replace(/\s+/g, " ")),
          fonts.regular,
          FOOTER_SIZE,
          contentWidth - labelWidth - 2 * CELL_PADDING_X,
        ),
        {
          x: margin.left,
          y: footerBaseline,
          size: FOOTER_SIZE,
          font: fonts.regular,
          color: MUTED_COLOR,
        },
      );
    }
    footerPage.drawText(label, {
      x: margin.left + contentWidth - labelWidth,
      y: footerBaseline,
      size: FOOTER_SIZE,
      font: fonts.regular,
      color: MUTED_COLOR,
    });
  });

  const pdfBytes = await pdf.save();
  return { pdfBytes, pageCount: pages.length };
}
