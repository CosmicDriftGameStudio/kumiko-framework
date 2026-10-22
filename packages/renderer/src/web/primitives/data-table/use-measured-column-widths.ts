import { type RefObject, useLayoutEffect, useRef, useState } from "react";
import { ACTIONS_CONTENT_ATTRIBUTE } from "./actions-column.tsx";

export const COLUMN_FIELD_ATTRIBUTE = "data-column-field";
export const EXPAND_COLUMN_WIDTH_PX = 40;
export const SELECT_COLUMN_WIDTH_PX = 40;

export type MeasuredColumnWidths = {
  readonly fields: Readonly<Record<string, number>>;
  readonly select: number;
  readonly expand: number;
  readonly actions: number;
};

const NOT_MEASURED: MeasuredColumnWidths = { fields: {}, select: 0, expand: 0, actions: 0 };

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

function widthOfElement(element: Element): number {
  return roundToHundredth(element.getBoundingClientRect().width);
}

function horizontalPadding(element: Element): number {
  const style = getComputedStyle(element);
  return (Number.parseFloat(style.paddingLeft) || 0) + (Number.parseFloat(style.paddingRight) || 0);
}

// Under a fixed table layout the actions column has no width of its own, so its
// header cell reports the leftover space. The wrapped content gives its natural width.
function naturalActionsWidth(headerRow: HTMLElement, headerCell: Element): number {
  const contents = headerRow
    .closest("table")
    ?.querySelectorAll(`:scope > tbody > tr > td > [${ACTIONS_CONTENT_ATTRIBUTE}]`);
  if (contents === undefined || contents.length === 0) return widthOfElement(headerCell);
  let widest = 0;
  for (const content of contents) {
    const cell = content.parentElement;
    const width = widthOfElement(content) + (cell === null ? 0 : horizontalPadding(cell));
    widest = Math.max(widest, width);
  }
  return roundToHundredth(widest);
}

function measureHeaderRow(headerRow: HTMLElement): MeasuredColumnWidths {
  const fields: Record<string, number> = {};
  let select = 0;
  let expand = 0;
  let actions = 0;
  for (const cell of headerRow.children) {
    const field = cell.getAttribute(COLUMN_FIELD_ATTRIBUTE);
    const testId = cell.getAttribute("data-testid");
    if (field !== null) fields[field] = widthOfElement(cell);
    else if (testId === "column-select") select = widthOfElement(cell);
    else if (testId === "column-expand") expand = widthOfElement(cell);
    else if (testId === "column-actions") actions = naturalActionsWidth(headerRow, cell);
  }
  return { fields, select, expand, actions };
}

function isSameMeasurement(a: MeasuredColumnWidths, b: MeasuredColumnWidths): boolean {
  if (a.select !== b.select || a.expand !== b.expand || a.actions !== b.actions) return false;
  const aKeys = Object.keys(a.fields);
  return (
    aKeys.length === Object.keys(b.fields).length && aKeys.every((k) => a.fields[k] === b.fields[k])
  );
}

/** Header cell widths for sticky offsets and the fixed layout's total width; undefined while disabled. */
export function useMeasuredColumnWidths(enabled: boolean): {
  readonly headerRowRef: RefObject<HTMLTableRowElement | null>;
  readonly measured: MeasuredColumnWidths | undefined;
} {
  const headerRowRef = useRef<HTMLTableRowElement>(null);
  const [measured, setMeasured] = useState(NOT_MEASURED);

  // Every render: rows and columns change without a stable key, and setMeasured
  // bails out on equal widths, so this cannot loop.
  useLayoutEffect(() => {
    const headerRow = headerRowRef.current;
    // skip: disabled or not mounted yet means there is no header row to measure
    if (!enabled || headerRow === null) return;
    const update = (): void => {
      const next = measureHeaderRow(headerRow);
      setMeasured((previous) => (isSameMeasurement(previous, next) ? previous : next));
    };
    update();
    // skip: without ResizeObserver the one measurement above is all we get
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    for (const cell of headerRow.children) observer.observe(cell);
    return () => observer.disconnect();
  });

  return { headerRowRef, measured: enabled ? measured : undefined };
}
