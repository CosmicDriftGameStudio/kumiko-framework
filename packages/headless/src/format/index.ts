// Pure format utilities — no web or platform dependencies.
// Shared between renderer-web, renderer-native, and server-side tests.

import { Temporal } from "temporal-polyfill";

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
      return toPlainDate(raw).toLocaleString(locale);
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
function formatNumberCell(value: unknown, locale?: string): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return String(value);
  try {
    return new Intl.NumberFormat(locale).format(value);
  } catch {
    // Malformed BCP-47 locale tag — mirrors formatDateCell's fallback above.
    return String(value);
  }
}

export { escapeHtml, escapeHtmlAttr, escapeXml, isSafeHref, stripControlChars } from "./escape";
export { type HtmlValue, html, RawHtml, raw } from "./html-template";
export { currencyDecimals } from "./money";
export function applyFormatSpec(
  spec: { format: string } & Record<string, unknown>,
  value: unknown,
): string {
  const isEmpty = value === null || value === undefined || value === "";
  // priority renders its emptyLabel for empty values — every other format
  // collapses empty to "".
  if (isEmpty && spec.format !== "priority") return "";
  switch (spec.format) {
    case "timestamp":
    case "date":
      return formatDateCell(value, spec.format, {
        locale: spec["locale"] as string | undefined,
        dateStyle: spec["dateStyle"] as Intl.DateTimeFormatOptions["dateStyle"],
        timeStyle:
          spec.format === "timestamp"
            ? (spec["timeStyle"] as Intl.DateTimeFormatOptions["timeStyle"])
            : undefined,
      });
    case "boolean": {
      if (value === true) return (spec["trueLabel"] as string | undefined) ?? "✓";
      if (value === false) return (spec["falseLabel"] as string | undefined) ?? "";
      return "";
    }
    case "currency": {
      const sym = (spec["symbol"] as string | undefined) ?? "";
      return sym.length > 0 ? `${value} ${sym}` : String(value);
    }
    case "number":
    case "decimal":
    case "bigInt":
      return formatNumberCell(value, spec["locale"] as string | undefined);
    case "priority": {
      const emptyLabel = (spec["emptyLabel"] as string | undefined) ?? "—";
      const prefix = (spec["prefix"] as string | undefined) ?? "";
      if (isEmpty || value === 0) return emptyLabel;
      return `${prefix}${value}`;
    }
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
