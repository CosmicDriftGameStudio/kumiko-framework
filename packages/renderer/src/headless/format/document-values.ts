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

// The long date a rendered mail or PDF prints for a `date` placeholder; the editor's
// sample values use it too, so both show the same text.
export function formatDocumentDate(value: unknown, locale: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return value === undefined || value === null ? "" : String(value);
  }
  const safeLocale = resolveSafeMoneyLocale(locale);
  try {
    // A date-only string has no zone; going through an instant would show the
    // previous day west of UTC.
    if (typeof value === "string" && DATE_ONLY.test(value)) {
      return Temporal.PlainDate.from(value).toLocaleString(safeLocale, { dateStyle: "long" });
    }
    // An explicit offset names the sender's zone: the calendar date is the wall-clock
    // date of the string, not the date at UTC.
    if (typeof value === "string" && DATE_TIME_WITH_OFFSET.test(value)) {
      return Temporal.PlainDateTime.from(value)
        .toPlainDate()
        .toLocaleString(safeLocale, { dateStyle: "long" });
    }
    const instant =
      typeof value === "number"
        ? Temporal.Instant.fromEpochMilliseconds(value)
        : Temporal.Instant.from(value);
    return instant.toLocaleString(safeLocale, { dateStyle: "long", timeZone: "UTC" });
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
