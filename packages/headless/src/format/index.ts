// Pure format utilities — no web or platform dependencies.
// Shared between renderer-web, renderer-native, and server-side tests.

import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isOneOf } from "@cosmicdrift/kumiko-types/type-guards";

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
    });
  } catch {
    return String(value);
  }
}

// No `locale` fallback to a browser API here (headless has none) — passing
// `undefined` to Intl.NumberFormat resolves the runtime's default locale,
// the same value a browser's navigator.language-based guess would produce.
function formatNumberCell(value: unknown, locale?: string, grouping = true): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(locale, { useGrouping: grouping }).format(value);
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

export { escapeHtml, escapeHtmlAttr, escapeXml, isSafeHref, stripControlChars } from "./escape.js";
export { type HtmlValue, html, RawHtml, raw } from "./html-template.js";
export { currencyDecimals, formatMoney, resolveSafeMoneyLocale } from "./money.js";

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

export function applyFormatSpec(
  spec: { format: string } & Record<string, unknown>,
  value: unknown,
  translate?: (key: string) => string,
): string {
  const isEmpty = value === null || value === undefined || value === "";
  // priority renders its emptyLabel for empty values — every other format
  // collapses empty to "".
  if (isEmpty && spec.format !== "priority") return "";
  switch (spec.format) {
    case "timestamp":
    case "date":
      return formatDateCell(value, spec.format, {
        locale: stringSpec(spec, "locale"),
        dateStyle: dateStyleSpec(spec, "dateStyle"),
        timeStyle: spec.format === "timestamp" ? dateStyleSpec(spec, "timeStyle") : undefined,
      });
    case "boolean": {
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
    case "currency": {
      const sym = stringSpec(spec, "symbol") ?? "";
      return sym.length > 0 ? `${value} ${sym}` : String(value);
    }
    case "number":
    case "decimal":
    case "bigInt":
      return formatNumberCell(
        value,
        stringSpec(spec, "locale"),
        booleanSpec(spec, "grouping") ?? true,
      );
    case "unit":
      return formatUnitCell(
        value,
        stringSpec(spec, "unit"),
        stringSpec(spec, "locale"),
        unitDisplaySpec(spec),
      );
    case "priority": {
      const emptyLabel = stringSpec(spec, "emptyLabel") ?? "—";
      const prefix = stringSpec(spec, "prefix") ?? "";
      if (isEmpty || value === 0) return emptyLabel;
      return `${prefix}${value}`;
    }
    case "enumOption": {
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
    case "image":
    case "file":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "json":
      return stringifyJsonOrString(value, typeof spec["indent"] === "number" ? spec["indent"] : 2);
    default:
      if (typeof process !== "undefined" && process.env.NODE_ENV !== "production") {
        // biome-ignore lint/suspicious/noConsole: dev-only warning
        console.warn(
          `[kumiko] applyFormatSpec: unknown format key "${spec.format}" — registered via FieldFormatRegistry module augmentation?`,
        );
      }
      return typeof value === "string" ? value : String(value);
  }
}
