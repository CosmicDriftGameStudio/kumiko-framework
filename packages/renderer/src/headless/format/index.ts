// Pure format utilities — no web or platform dependencies.
// Shared between renderer/web and server-side tests.

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";
import { rendererWarn } from "../../dev-console.ts";

export const EMPTY_VALUE_PLACEHOLDER = "—";

function toPlainDate(raw: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(raw);
  } catch {
    // "date"-typed field stored as a full instant (day-boundary timestamp) —
    // take the calendar date in the local zone rather than fail.
    return toInstant(raw).toZonedDateTimeISO(Temporal.Now.timeZoneId()).toPlainDate();
  }
}

// Temporal.Instant.from is stricter than the `new Date(raw)` this replaced:
// it requires a UTC designator/offset (Z/+hh:mm). Timestamps without one
// (e.g. "2026-07-18T12:00:00", still valid input to `new Date`) throw here
// instead of parsing — fall back to reading them as a local wall-clock time,
// same posture as toPlainDate's own fallback above.
export function toInstant(raw: string): Temporal.Instant {
  try {
    return Temporal.Instant.from(raw);
  } catch {
    return Temporal.PlainDateTime.from(raw).toZonedDateTime(Temporal.Now.timeZoneId()).toInstant();
  }
}

function formatDateCell(
  value: unknown,
  type: string,
  opts?: {
    locale?: string;
    dateStyle?: Intl.DateTimeFormatOptions["dateStyle"];
    timeStyle?: Intl.DateTimeFormatOptions["timeStyle"];
    timeZone?: string;
  },
): string {
  try {
    const raw = typeof value === "string" ? value : String(value);
    const locale = opts?.locale;
    if (opts?.dateStyle || opts?.timeStyle) {
      if (type === "date") {
        // ponytail: timeStyle is ignored here on purpose — a PlainDate has no
        // time component to format, so a timeStyle-only "date" field falls
        // back to PlainDate's default dateStyle instead of rendering a time.
        return toPlainDate(raw).toLocaleString(locale, {
          dateStyle: opts.dateStyle,
        });
      }
      return toInstant(raw).toLocaleString(locale, {
        dateStyle: opts.dateStyle,
        timeStyle: opts.timeStyle,
        timeZone: opts.timeZone,
      });
    }
    if (type === "date") {
      return toPlainDate(raw).toLocaleString(locale, {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });
    }
    return toInstant(raw).toLocaleString(locale, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: opts?.timeZone,
    });
  } catch {
    return String(value);
  }
}

// No `locale` fallback to a browser API here (headless has none) — passing
// `undefined` to Intl.NumberFormat resolves the runtime's default locale,
// the same value a browser's navigator.language-based guess would produce.
function formatNumberCell(
  value: unknown,
  locale?: string,
  grouping = true,
  fractionDigits: FractionDigitsSpec = {},
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(locale, { useGrouping: grouping, ...fractionDigits }).format(
      value,
    );
  } catch {
    // Malformed BCP-47 locale tag — mirrors formatDateCell's fallback above.
    return String(value);
  }
}

// Two-tier unit table for `{ format: "unit" }`. Keys mirror
// @cosmicdrift/kumiko-types' UnitKey (kept as a local literal union instead
// of an import — headless has no build-time dependency on kumiko-types
// today, and applyFormatSpec's spec param is already an untyped
// Record<string, unknown>, cast per-case like every other format below).
const UNIT_INTL_IDS = {
  km: "kilometer",
  m: "meter",
  kg: "kilogram",
  percent: "percent",
  mi: "mile",
} as const;

// "m2" (square meter) has no ECMA-402 sanctioned unit — Intl.NumberFormat
// throws RangeError for "square-meter". Locale-format the number and append
// the literal suffix instead of going through `style: "unit"`.
const UNIT_SUFFIXES = { m2: "m²" } as const;

function isIntlUnit(unit: string): unit is keyof typeof UNIT_INTL_IDS {
  return Object.hasOwn(UNIT_INTL_IDS, unit);
}

function isSuffixUnit(unit: string): unit is keyof typeof UNIT_SUFFIXES {
  return Object.hasOwn(UNIT_SUFFIXES, unit);
}

function formatUnitCell(
  value: unknown,
  unit: string | undefined,
  locale: string | undefined,
  unitDisplay: Intl.NumberFormatOptions["unitDisplay"],
): string {
  const n = typeof value === "number" ? value : Number(value);
  if (unit === undefined || !Number.isFinite(n)) return String(value);
  if (isIntlUnit(unit)) {
    try {
      return new Intl.NumberFormat(locale, {
        style: "unit",
        unit: UNIT_INTL_IDS[unit],
        unitDisplay,
      }).format(n);
    } catch {
      // Malformed BCP-47 locale tag — mirrors formatNumberCell's fallback below.
      return formatNumberCell(n, locale);
    }
  }
  if (isSuffixUnit(unit)) {
    return `${formatNumberCell(n, locale)} ${UNIT_SUFFIXES[unit]}`;
  }
  return String(value);
}

/** Exported for UnitKey parity tests against @cosmicdrift/kumiko-types/screen. */
export const UNIT_FORMAT_KEYS: readonly string[] = [
  ...Object.keys(UNIT_INTL_IDS),
  ...Object.keys(UNIT_SUFFIXES),
];

export {
  DOCUMENT_FALLBACK_CURRENCY,
  type DocumentDateOptions,
  formatDocumentDate,
  formatDocumentMoney,
  formatDocumentPercent,
} from "./document-values.ts";
export { escapeHtml, escapeHtmlAttr, escapeXml, isSafeHref, stripControlChars } from "./escape.ts";
export { type HtmlValue, html, RawHtml, raw } from "./html-template.ts";
export { currencyDecimals, formatMoney, resolveSafeMoneyLocale } from "./money.ts";

// JSON.stringify throws on BigInt and circular values; a cell must degrade to text instead of crashing the screen.
function stringifyJsonOrString(value: unknown, indent: number): string {
  try {
    return JSON.stringify(value, null, indent) ?? String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return "[unserializable value]";
    }
  }
}

const INTL_DATE_STYLES = ["full", "long", "medium", "short"] as const;
const INTL_UNIT_DISPLAYS = ["short", "long", "narrow"] as const;

function stringSpec(spec: Record<string, unknown>, key: string): string | undefined {
  const v = spec[key];
  return typeof v === "string" ? v : undefined;
}

type FractionDigitsSpec = {
  readonly minimumFractionDigits?: number;
  readonly maximumFractionDigits?: number;
};

const MAX_FRACTION_DIGITS = 20;

function fractionDigitSpec(spec: Record<string, unknown>, key: string): number | undefined {
  const v = spec[key];
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_FRACTION_DIGITS
    ? v
    : undefined;
}

// Out-of-range or inverted options fall back to the Intl default instead of
// throwing: a bad schema option must not crash the screen it renders in.
function fractionDigitsSpec(spec: Record<string, unknown>): FractionDigitsSpec {
  const min = fractionDigitSpec(spec, "minimumFractionDigits");
  const max = fractionDigitSpec(spec, "maximumFractionDigits");
  if (min !== undefined && max !== undefined && min > max) return {};
  return {
    ...(min !== undefined && { minimumFractionDigits: min }),
    ...(max !== undefined && { maximumFractionDigits: max }),
  };
}

function booleanSpec(spec: Record<string, unknown>, key: string): boolean | undefined {
  const v = spec[key];
  return typeof v === "boolean" ? v : undefined;
}

function dateStyleSpec(
  spec: Record<string, unknown>,
  key: string,
): Intl.DateTimeFormatOptions["dateStyle"] {
  const v = spec[key];
  return isOneOf(INTL_DATE_STYLES, v) ? v : undefined;
}

function unitDisplaySpec(spec: Record<string, unknown>): Intl.NumberFormatOptions["unitDisplay"] {
  const v = spec["unitDisplay"];
  return isOneOf(INTL_UNIT_DISPLAYS, v) ? v : "short";
}

type CellFormatSpec = { format: string } & Record<string, unknown>;
type CellTranslate = ((key: string) => string) | undefined;
type CellFormatter = (spec: CellFormatSpec, value: unknown, translate: CellTranslate) => string;

function isEmptyCellValue(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

export function applyFormatSpec(
  spec: { format: string } & Record<string, unknown>,
  value: unknown,
  translate?: (key: string) => string,
): string {
  // priority renders its emptyLabel for empty values — every other format
  // collapses empty to "".
  if (isEmptyCellValue(value) && spec.format !== "priority") return "";
  if (!isBuiltInCellFormat(spec.format)) return formatUnknownCellFormat(spec, value);
  return CELL_FORMATTERS[spec.format](spec, value, translate);
}

function formatTemporalCell(spec: CellFormatSpec, value: unknown): string {
  const isTimestamp = spec.format === "timestamp";
  return formatDateCell(value, spec.format, {
    locale: stringSpec(spec, "locale"),
    dateStyle: dateStyleSpec(spec, "dateStyle"),
    timeStyle: isTimestamp ? dateStyleSpec(spec, "timeStyle") : undefined,
    timeZone: isTimestamp ? stringSpec(spec, "timeZone") : undefined,
  });
}

function formatBooleanCell(spec: CellFormatSpec, value: unknown, translate: CellTranslate): string {
  if (value === true) {
    const trueLabel = stringSpec(spec, "trueLabel");
    return trueLabel === undefined ? "✓" : (translate?.(trueLabel) ?? trueLabel);
  }
  if (value === false) {
    const falseLabel = stringSpec(spec, "falseLabel");
    return falseLabel === undefined ? "" : (translate?.(falseLabel) ?? falseLabel);
  }
  return "";
}

function formatCurrencyCell(spec: CellFormatSpec, value: unknown): string {
  const sym = stringSpec(spec, "symbol") ?? "";
  return sym.length > 0 ? `${value} ${sym}` : String(value);
}

function formatNumericCell(spec: CellFormatSpec, value: unknown): string {
  return formatNumberCell(
    value,
    stringSpec(spec, "locale"),
    booleanSpec(spec, "grouping") ?? true,
    spec.format === "bigInt" ? {} : fractionDigitsSpec(spec),
  );
}

function formatUnitSpecCell(spec: CellFormatSpec, value: unknown): string {
  return formatUnitCell(
    value,
    stringSpec(spec, "unit"),
    stringSpec(spec, "locale"),
    unitDisplaySpec(spec),
  );
}

function formatPriorityCell(spec: CellFormatSpec, value: unknown): string {
  const emptyLabel = stringSpec(spec, "emptyLabel") ?? EMPTY_VALUE_PLACEHOLDER;
  const prefix = stringSpec(spec, "prefix") ?? "";
  if (isEmptyCellValue(value) || value === 0) return emptyLabel;
  return `${prefix}${value}`;
}

function formatEnumOptionCell(
  spec: CellFormatSpec,
  value: unknown,
  translate: CellTranslate,
): string {
  const keyPrefix = stringSpec(spec, "keyPrefix");
  const labelFor = (item: unknown): string => {
    const raw = typeof item === "string" ? item : String(item);
    if (keyPrefix === undefined || translate === undefined) return raw;
    const key = `${keyPrefix}${raw}`;
    const translated = translate(key);
    return translated === key ? raw : translated;
  };
  // multiSelect-style columns hold an array of option values
  return Array.isArray(value) ? value.map(labelFor).join(", ") : labelFor(value);
}

// Thumbnails and file links are drawn by the web list cell; this is the
// text fallback for every other surface.
function formatFileCell(_spec: CellFormatSpec, value: unknown): string {
  return Array.isArray(value) ? value.join(", ") : String(value);
}

function formatJsonCell(spec: CellFormatSpec, value: unknown): string {
  return stringifyJsonOrString(value, typeof spec["indent"] === "number" ? spec["indent"] : 2);
}

const CELL_FORMATTERS = {
  timestamp: formatTemporalCell,
  date: formatTemporalCell,
  boolean: formatBooleanCell,
  currency: formatCurrencyCell,
  number: formatNumericCell,
  decimal: formatNumericCell,
  bigInt: formatNumericCell,
  unit: formatUnitSpecCell,
  priority: formatPriorityCell,
  enumOption: formatEnumOptionCell,
  image: formatFileCell,
  file: formatFileCell,
  json: formatJsonCell,
} as const satisfies Readonly<Record<string, CellFormatter>>;

// Own-key check: a format such as "toString" must not resolve to an inherited member.
function isBuiltInCellFormat(format: string): format is keyof typeof CELL_FORMATTERS {
  return Object.hasOwn(CELL_FORMATTERS, format);
}

function formatUnknownCellFormat(spec: CellFormatSpec, value: unknown): string {
  if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
    rendererWarn(
      `[kumiko] applyFormatSpec: unknown format key "${spec.format}" — registered via FieldFormatRegistry module augmentation?`,
    );
  }
  return typeof value === "string" ? value : String(value);
}
