import type { Element as ScanElement } from "happy-dom";
import {
  readBlockStyleAttributes,
  readCellBackground,
  readColwidth,
  readFrameAttributes,
  readTextStyleAttributes,
} from "./web/document-print-style.ts";
import {
  documentBlockStyleCss,
  documentCellStyleCss,
  documentFrameCss,
  documentTextStyleCss,
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

function applyTables(root: ScanElement): void {
  for (const table of Array.from(root.querySelectorAll("table"))) {
    if (table.getAttribute("data-borders") === "none") addClass(table, "kumiko-table-plain");
    const widths = firstRowColumnWidths(table);
    if (widths !== null) insertColgroup(table, widths);
  }
  for (const cell of Array.from(root.querySelectorAll("td, th"))) {
    appendStyle(cell, documentCellStyleCss({ background: readCellBackground(cell) }));
  }
}

// Runs before the placeholder rewrites: a rich text block host copies its paragraph's
// attributes, so the style has to be on the paragraph by then.
export function applyDocumentPrintStyles(root: ScanElement): void {
  applyFrames(root);
  applyTables(root);
  for (const span of Array.from(root.querySelectorAll("span[data-text-style]"))) {
    appendStyle(span, documentTextStyleCss(readTextStyleAttributes(span)));
  }
  for (const block of Array.from(root.querySelectorAll("p, h1, h2, h3"))) {
    appendStyle(block, documentBlockStyleCss(readBlockStyleAttributes(block)));
  }
}
