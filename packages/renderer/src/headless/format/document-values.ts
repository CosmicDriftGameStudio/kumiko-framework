import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { formatMoney, resolveSafeMoneyLocale } from "./money.ts";

// Used when the tenant has no currency setting.
export const DOCUMENT_FALLBACK_CURRENCY = "EUR";
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T.*[+-]\d{2}(:?\d{2})?$/;

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// A bare number is minor units in the tenant currency; a `{ amount, currency }`
// record brings its own currency.
export function formatDocumentMoney(
  value: unknown,
  tenantCurrency: string,
  locale: string,
): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatMoney(value, tenantCurrency, locale);
  }
  if (isPlainRecord(value)) {
    const { amount, currency } = value;
    if (typeof amount === "number" && Number.isFinite(amount) && typeof currency === "string") {
      return formatMoney(amount, currency, locale);
    }
  }
  return value === undefined || value === null ? "" : String(value);
}

/** "long" is "15. Januar 2026", "short" the numeric "15.01.2026" of the locale. */
export type DocumentDateStyle = "short" | "long";

const SHORT_DATE_FIELDS = { day: "2-digit", month: "2-digit", year: "numeric" } as const;

function dateFields(style: DocumentDateStyle | undefined): Intl.DateTimeFormatOptions {
  return style === "short" ? SHORT_DATE_FIELDS : { dateStyle: "long" };
}

export type DocumentDateOptions = {
  readonly dateStyle?: DocumentDateStyle;
  /** Append the time of day. Only instants and offset date-times carry one; a
   *  date-only value prints just the date. */
  readonly time?: boolean;
  /** IANA zone an instant is shown in (default UTC). Offset date-times keep
   *  their own wall clock. */
  readonly timeZone?: string;
};

function formatOffsetDateTime(
  value: string,
  locale: string,
  withTime: boolean,
  dateStyle: DocumentDateStyle | undefined,
): string {
  const wallClock = Temporal.PlainDateTime.from(value);
  if (!withTime) return wallClock.toPlainDate().toLocaleString(locale, dateFields(dateStyle));
  return wallClock.toLocaleString(locale, timeFields(dateStyle));
}

// Intl rejects dateStyle and individual date fields in one call, so a short date with a time
// spells the time as fields too.
function timeFields(dateStyle: DocumentDateStyle | undefined): Intl.DateTimeFormatOptions {
  return dateStyle === "short"
    ? { ...SHORT_DATE_FIELDS, hour: "2-digit", minute: "2-digit" }
    : { dateStyle: "long", timeStyle: "short" };
}

function instantFormatOptions(options: DocumentDateOptions): Intl.DateTimeFormatOptions {
  if (options.time !== true) return { ...dateFields(options.dateStyle), timeZone: "UTC" };
  return { ...timeFields(options.dateStyle), timeZone: options.timeZone ?? "UTC" };
}

// The long date a rendered mail or PDF prints for a `date` placeholder; the editor's
// sample values use it too, so both show the same text.
export function formatDocumentDate(
  value: unknown,
  locale: string,
  options: DocumentDateOptions = {},
): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return value === undefined || value === null ? "" : String(value);
  }
  const safeLocale = resolveSafeMoneyLocale(locale);
  try {
    // A date-only string has no zone; going through an instant would show the
    // previous day west of UTC.
    if (typeof value === "string" && DATE_ONLY.test(value)) {
      return Temporal.PlainDate.from(value).toLocaleString(
        safeLocale,
        dateFields(options.dateStyle),
      );
    }
    // An explicit offset names the sender's zone: the calendar date is the wall-clock
    // date of the string, not the date at UTC.
    if (typeof value === "string" && DATE_TIME_WITH_OFFSET.test(value)) {
      return formatOffsetDateTime(value, safeLocale, options.time === true, options.dateStyle);
    }
    const instant =
      typeof value === "number"
        ? Temporal.Instant.fromEpochMilliseconds(value)
        : Temporal.Instant.from(value);
    return instant.toLocaleString(safeLocale, instantFormatOptions(options));
  } catch {
    return String(value);
  }
}

export function formatDocumentPercent(value: unknown, locale: string): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Intl.NumberFormat(resolveSafeMoneyLocale(locale), {
      style: "percent",
      maximumFractionDigits: 2,
    }).format(value / 100);
  }
  return value === undefined || value === null ? "" : String(value);
}
