import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { Cell } from "write-excel-file/node";
import { referenceCell } from "./export-cells-reference.ts";
import type { ExportCellKind, ExportColumn, SimpleCellKind } from "./export-columns.ts";
import type { ExportRow } from "./export-rows.ts";

export type Translate = (key: string) => string;

const DATE_FORMAT = "yyyy-mm-dd";
const TIMESTAMP_FORMAT = "yyyy-mm-dd hh:mm";
const PLAIN_MONEY_FORMAT = "#,##0.00";
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;

function isNullish(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

function textCell(value: string): Cell {
  return { value, type: String };
}

function numberCell(value: number, format?: string): Cell {
  return { value, type: Number, ...(format !== undefined && { format }) };
}

function toFiniteNumber(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return value !== "" && Number.isFinite(n) ? n : undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "object" && value !== null) {
    // Temporal values stringify to ISO via toString; plain data goes through JSON.
    const text = String(value);
    return text === "[object Object]" ? JSON.stringify(value) : text;
  }
  return String(value);
}

function fromEpochMillis(value: unknown): Date | undefined {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value;
  if (typeof value === "object" && value !== null && "epochMilliseconds" in value) {
    return fromEpochMillis(new Date(Number(value.epochMilliseconds)));
  }
  if (typeof value === "string" || typeof value === "number") {
    return fromEpochMillis(new Date(value));
  }
  return undefined;
}

// Date-only values are anchored at UTC midnight, never parsed through the local zone.
function toUtcDate(value: unknown): Date | undefined {
  const text = typeof value === "string" ? value : isNullish(value) ? "" : stringify(value);
  if (ISO_DATE.test(text)) return fromEpochMillis(new Date(`${text}T00:00:00Z`));
  return undefined;
}

function dateCell(value: unknown): Cell {
  const date = toUtcDate(value) ?? fromEpochMillis(value);
  return date === undefined
    ? textCell(stringify(value))
    : { value: date, type: Date, format: DATE_FORMAT };
}

// The sheet has no time zone, so the instant is shifted to the wall clock of `timeZone` and
// stored as if that wall clock were UTC.
function timestampCell(value: unknown, timeZone: string): Cell {
  const date = fromEpochMillis(value);
  if (date === undefined) return textCell(stringify(value));
  const wall = Temporal.Instant.fromEpochMilliseconds(date.getTime()).toZonedDateTimeISO(timeZone);
  const shifted = new Date(
    Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second),
  );
  return { value: shifted, type: Date, format: TIMESTAMP_FORMAT };
}

// `at` is the wall clock in the record's own zone without offset; reading it as UTC keeps the
// digits the user saw in the list.
function locatedTimestampCell(value: unknown): Cell {
  const at =
    typeof value === "object" && value !== null && "at" in value ? String(value.at) : undefined;
  const date = at === undefined ? undefined : fromEpochMillis(new Date(`${at}Z`));
  return date === undefined
    ? textCell(stringify(value))
    : { value: date, type: Date, format: TIMESTAMP_FORMAT };
}

function moneyCell(value: unknown): Cell {
  if (typeof value !== "object" || value === null || !("amount" in value)) {
    const n = toFiniteNumber(value);
    return n === undefined ? textCell(stringify(value)) : numberCell(n, PLAIN_MONEY_FORMAT);
  }
  const amount = toFiniteNumber(value.amount);
  if (amount === undefined) return textCell(stringify(value.amount));
  const currency = "currency" in value ? String(value.currency) : "";
  const format = CURRENCY_CODE.test(currency)
    ? `${PLAIN_MONEY_FORMAT} "${currency}"`
    : PLAIN_MONEY_FORMAT;
  return numberCell(amount, format);
}

function integerCell(value: unknown, kind: "number" | "decimal" | "bigInt"): Cell {
  const n = toFiniteNumber(value);
  if (n === undefined) return textCell(stringify(value));
  // A bigInt beyond 2^53 would lose digits as a spreadsheet number.
  if (kind === "bigInt" && !Number.isSafeInteger(n)) return textCell(stringify(value));
  return numberCell(n);
}

function optionLabel(prefix: string, raw: unknown, translate: Translate): string {
  const text = String(raw);
  const label = translate(`${prefix}${text}`);
  return label === `${prefix}${text}` ? text : label;
}

function autoCell(value: unknown): Cell {
  if (typeof value === "number" && Number.isFinite(value)) return numberCell(value);
  if (typeof value === "boolean") return { value, type: Boolean };
  return textCell(stringify(value));
}

function optionCell(
  cell: Extract<ExportCellKind, { optionLabelKeyPrefix: string }>,
  value: unknown,
  translate: Translate,
): Cell {
  const values = cell.kind === "multiSelect" && Array.isArray(value) ? value : [value];
  return textCell(
    values.map((v) => optionLabel(cell.optionLabelKeyPrefix, v, translate)).join(", "),
  );
}

const SIMPLE_CELL_BUILDERS: Readonly<
  Record<SimpleCellKind, (value: unknown, timeZone: string) => Cell>
> = {
  number: (value) => integerCell(value, "number"),
  decimal: (value) => integerCell(value, "decimal"),
  bigInt: (value) => integerCell(value, "bigInt"),
  money: (value) => moneyCell(value),
  date: (value) => dateCell(value),
  timestamp: timestampCell,
  locatedTimestamp: (value) => locatedTimestampCell(value),
  boolean: (value) =>
    typeof value === "boolean" ? { value, type: Boolean } : textCell(stringify(value)),
  auto: (value) => autoCell(value),
  text: (value) => textCell(stringify(value)),
};

export type ExportCellContext = {
  readonly row: ExportRow;
  readonly translate: Translate;
  readonly timeZone: string;
};

/** Never emits a formula cell and never reinterprets strings: text always stays text. */
export function toExportCell(column: ExportColumn, context: ExportCellContext): Cell {
  const { cell, field } = column;
  const value = context.row[field];
  if (isNullish(value)) return null;
  if (cell.kind === "reference") return referenceCell(cell, field, context.row);
  if ("optionLabelKeyPrefix" in cell) return optionCell(cell, value, context.translate);
  return SIMPLE_CELL_BUILDERS[cell.kind](value, context.timeZone);
}
