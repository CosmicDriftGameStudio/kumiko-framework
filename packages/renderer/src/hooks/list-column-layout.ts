import type {
  DataTableColumnPin,
  DataTableColumnPins,
  DataTableColumnWidths,
} from "../data-table-view-types.ts";

export const DEFAULT_COLUMN_WIDTH_PX = 160;
export const DEFAULT_MIN_COLUMN_WIDTH_PX = 64;
/** Upper bound so a tampered stored width cannot blow the table up. */
export const MAX_COLUMN_WIDTH_PX = 2000;

type LayoutSchemaColumn = {
  readonly field: string;
  readonly pinned?: DataTableColumnPin;
  readonly width?: number;
  readonly minWidth?: number;
};

export function defaultPins(schema: readonly LayoutSchemaColumn[]): DataTableColumnPins {
  const pins: Record<string, DataTableColumnPin> = {};
  for (const column of schema) {
    if (column.pinned !== undefined) pins[column.field] = column.pinned;
  }
  return pins;
}

export function minWidthsOf(schema: readonly LayoutSchemaColumn[]): DataTableColumnWidths {
  return Object.fromEntries(
    schema.map((column) => [column.field, column.minWidth ?? DEFAULT_MIN_COLUMN_WIDTH_PX]),
  );
}

export function clampWidth(width: number, min: number): number {
  return Math.min(MAX_COLUMN_WIDTH_PX, Math.max(min, Math.round(width)));
}

/** Only columns with a schema `width`: the others are sized by their content until the user resizes. */
export function defaultWidths(
  schema: readonly LayoutSchemaColumn[],
  minWidths: DataTableColumnWidths,
): DataTableColumnWidths {
  return Object.fromEntries(
    schema.flatMap((column) =>
      column.width === undefined
        ? []
        : [
            [
              column.field,
              clampWidth(column.width, minWidths[column.field] ?? DEFAULT_MIN_COLUMN_WIDTH_PX),
            ],
          ],
    ),
  );
}

/** A saved width wins per field; fields the schema no longer has are dropped. */
export function mergeSavedWidths(
  defaults: DataTableColumnWidths,
  saved: Readonly<Record<string, number>>,
  minWidths: DataTableColumnWidths,
): DataTableColumnWidths {
  return Object.fromEntries(
    Object.keys(minWidths).flatMap((field) => {
      const savedWidth = saved[field];
      const min = minWidths[field] ?? DEFAULT_MIN_COLUMN_WIDTH_PX;
      if (savedWidth !== undefined) return [[field, clampWidth(savedWidth, min)]];
      const fallback = defaults[field];
      return fallback === undefined ? [] : [[field, fallback]];
    }),
  );
}

export function clampWidths(
  widths: DataTableColumnWidths,
  minWidths: DataTableColumnWidths,
): DataTableColumnWidths {
  return Object.fromEntries(
    Object.entries(widths).flatMap(([field, width]) =>
      field in minWidths
        ? [[field, clampWidth(width, minWidths[field] ?? DEFAULT_MIN_COLUMN_WIDTH_PX)]]
        : [],
    ),
  );
}

export function sameRecord<T>(a: Readonly<Record<string, T>>, b: Readonly<Record<string, T>>) {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}
