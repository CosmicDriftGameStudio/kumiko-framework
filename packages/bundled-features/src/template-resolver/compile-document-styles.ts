import type { Element as ScanElement } from "happy-dom";
import {
  ROW_LINE_ABOVE_ATTRIBUTE,
  ROW_LINE_BELOW_ATTRIBUTE,
  readBlockStyleAttributes,
  readCellBackground,
  readCellPaddingMm,
  readColwidth,
  readDividerColor,
  readDividerWeightPt,
  readFrameAttributes,
  readImageAlign,
  readImageWidthMm,
  readRowLine,
  readTableAlign,
  readTableWidthMm,
  readTextStyleAttributes,
} from "./web/document-print-style.ts";
import {
  documentBlockStyleCss,
  documentCellStyleCss,
  documentDividerCss,
  documentFrameCss,
  documentImageCss,
  documentTableCss,
  documentTextStyleCss,
  resolveRowEdges,
} from "./web/document-style-css.ts";

// Appended after an existing style (data-align) so the alignment survives.
export function appendStyle(element: ScanElement, style: string): void {
  if (style === "") return;
  const existing = element.getAttribute("style");
  element.setAttribute("style", existing === null ? style : `${existing};${style}`);
}

function addClass(element: ScanElement, className: string): void {
  const existing = element.getAttribute("class");
  element.setAttribute("class", existing === null ? className : `${existing} ${className}`);
}

function roundPercent(value: number): number {
  return Math.round(value * 100) / 100;
}

// Percentages sum to exactly 100 so the table keeps the full content width.
function columnPercentages(widths: readonly number[]): number[] {
  const total = widths.reduce((sum, width) => sum + width, 0);
  const percentages = widths.map((width) => roundPercent((width / total) * 100));
  const last = percentages.length - 1;
  const others = percentages.slice(0, last).reduce((sum, value) => sum + value, 0);
  percentages[last] = roundPercent(100 - others);
  return percentages;
}

function firstRowColumnWidths(table: ScanElement): number[] | null {
  const firstRow = Array.from(table.querySelectorAll("tr")).find(
    (row) => row.closest("table") === table,
  );
  if (firstRow === undefined) return null;
  const widths: number[] = [];
  for (const cell of Array.from(firstRow.children)) {
    const colwidth = readColwidth(cell);
    const span = Number(cell.getAttribute("colspan") ?? 1);
    if (colwidth === null || colwidth.length !== span) return null;
    widths.push(...colwidth);
  }
  return widths.length > 0 ? widths : null;
}

function insertColgroup(table: ScanElement, widths: readonly number[]): void {
  const document = table.ownerDocument;
  const colgroup = document.createElement("colgroup");
  for (const percentage of columnPercentages(widths)) {
    const col = document.createElement("col");
    col.setAttribute("style", `width:${percentage}%`);
    colgroup.append(col);
  }
  table.insertBefore(colgroup, table.firstChild);
}

function applyFrames(root: ScanElement): void {
  for (const frame of Array.from(root.querySelectorAll("div[data-frame]"))) {
    const box = readFrameAttributes(frame);
    if (box === null) {
      frame.replaceWith(...Array.from(frame.childNodes));
      continue;
    }
    addClass(frame, "kumiko-frame");
    appendStyle(frame, documentFrameCss(box));
  }
}

function ownRows(table: ScanElement): ScanElement[] {
  return Array.from(table.querySelectorAll("tr")).filter((row) => row.closest("table") === table);
}

function applyTables(root: ScanElement): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (table.getAttribute("data-borders") === "none") addClass(table, "kumiko-table-plain");
    const widths = firstRowColumnWidths(table);
    if (widths !== null) insertColgroup(table, widths);
    appendStyle(
      table,
      documentTableCss({ widthMm: readTableWidthMm(table), align: readTableAlign(table) }),
    );
    const paddingMm = readCellPaddingMm(table);
    const rows = ownRows(table);
    const edges = resolveRowEdges(
      rows.map((row) => ({
        lineAbove: readRowLine(row, ROW_LINE_ABOVE_ATTRIBUTE),
        lineBelow: readRowLine(row, ROW_LINE_BELOW_ATTRIBUTE),
        repeats: row.hasAttribute("data-each"),
      })),
    );
    rows.forEach((row, rowIndex) => {
      const cells = Array.from(row.children).filter((cell) => cell.matches("td, th"));
      cells.forEach((cell, cellIndex) => {
        appendStyle(
          cell,
          documentCellStyleCss({
            background: readCellBackground(cell),
            paddingMm,
            isFirstInRow: cellIndex === 0,
            isLastInRow: cellIndex === cells.length - 1,
            edges: edges[rowIndex],
          }),
        );
      });
    });
  }
}

// A full-bleed image is placed by the region CSS, which an inline width would override.
function applyImages(root: ScanElement): void {
  for (const image of Array.from(root.querySelectorAll("img[data-width-mm], img[data-align]"))) {
    if (image.hasAttribute("data-bleed")) continue;
    appendStyle(
      image,
      documentImageCss({ widthMm: readImageWidthMm(image), align: readImageAlign(image) }),
    );
  }
}

function applyDividers(root: ScanElement): void {
  for (const divider of Array.from(root.querySelectorAll("hr[data-color], hr[data-weight-pt]"))) {
    appendStyle(
      divider,
      documentDividerCss({
        color: readDividerColor(divider),
        weightPt: readDividerWeightPt(divider),
      }),
    );
  }
}

// Runs before the placeholder rewrites: a rich text block host copies its paragraph's
// attributes, so the style has to be on the paragraph by then.
export function applyDocumentPrintStyles(root: ScanElement): void {
  applyFrames(root);
  applyTables(root);
  applyImages(root);
  applyDividers(root);
  for (const span of Array.from(root.querySelectorAll("span[data-text-style]"))) {
    appendStyle(span, documentTextStyleCss(readTextStyleAttributes(span)));
  }
  for (const block of Array.from(root.querySelectorAll("p, h1, h2, h3"))) {
    appendStyle(block, documentBlockStyleCss(readBlockStyleAttributes(block)));
  }
}
