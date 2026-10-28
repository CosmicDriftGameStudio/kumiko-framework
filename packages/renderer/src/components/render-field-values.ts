import type { FieldAffix } from "@cosmicdrift/kumiko-framework/ui-types";
import { propertyOf } from "@cosmicdrift/kumiko-types/type-guards";
import { currencyDecimals } from "../headless/index.ts";
import type { SelectOptionEntry } from "./availability-options-select.tsx";

export function stringValue(v: unknown): string {
  if (v === undefined || v === null) return "";
  return typeof v === "string" ? v : String(v);
}

export function numberValue(v: unknown): number | "" {
  if (v === undefined || v === null || v === "") return "";
  return typeof v === "number" ? v : Number(v);
}

// Read/initial value → MoneyInput's minor-units contract. The server's
// read shape is `{amount, currency, amountMinor}` in MAJOR units — deliberately
// NOT reading `amountMinor` here: the server derives it via a flat
// MINOR_UNIT_SCALE=100 (money.ts), which disagrees with currencyDecimals for
// zero-decimal currencies like JPY, so it would double-scale JPY amounts.
// Deriving from `amount * 10**currencyDecimals(currency)` keeps this the
// exact inverse of moneyPayload below. A bare number (e.g. ConfigEditBody's
// stored-config coercion) is MAJOR units too — every producer in this repo
// hands rehydrateMoney's `{amount,…}` shape or a raw major-unit number, never
// pre-scaled minor units.
// A stored row can carry a legacy/imported currency that is not an ISO-4217
// shape; Intl.NumberFormat throws a RangeError on it and would crash the screen.
const ISO_CURRENCY_CODE = /^[A-Z]{3}$/;

export function resolveMoneyCurrency(value: unknown, fieldCurrency: string | undefined): string {
  if (typeof value === "object" && value !== null && "currency" in value) {
    const { currency } = value;
    if (typeof currency === "string") {
      const normalized = currency.toUpperCase();
      if (ISO_CURRENCY_CODE.test(normalized)) return normalized;
    }
  }
  return fieldCurrency ?? "EUR";
}

// The suffix span is absolutely positioned inside a fixed right padding sized
// for short symbols; a free-text sibling value longer than any real unit
// symbol would overflow the number.
const MAX_SIBLING_UNIT_LENGTH = 8;

// Static unit → used as-is. Sibling-field reference → read the live row
// value; missing/empty/non-string/overlong sibling means no suffix, never a guess.
export function resolveNumberUnit(
  unit: string | { readonly field: string } | undefined,
  row: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (unit === undefined) return undefined;
  if (typeof unit === "string") return unit;
  const sibling = row?.[unit.field];
  if (typeof sibling !== "string") return undefined;
  const trimmed = sibling.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_SIBLING_UNIT_LENGTH ? trimmed : undefined;
}

// String affix → used as-is (the view model already translated it). Field
// affix → the live form value; missing, empty or non-scalar means no affix.
export function resolveAffix(
  affix: FieldAffix | undefined,
  row: Readonly<Record<string, unknown>> | undefined,
): string | undefined {
  if (affix === undefined) return undefined;
  if (typeof affix === "string") return affix;
  const value = row?.[affix.field];
  const text = typeof value === "number" ? String(value) : value;
  return typeof text === "string" && text.trim().length > 0 ? text.trim() : undefined;
}

export function stringArrayOf(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

// The ids a reference field currently points at: the array of a `refMultiple`
// field, else the single non-empty id.
export function selectedReferenceIds(field: {
  readonly value: unknown;
  readonly refMultiple?: boolean;
}): readonly string[] {
  if (field.refMultiple === true) return stringArrayOf(field.value);
  return typeof field.value === "string" && field.value !== "" ? [field.value] : [];
}

// The combobox cannot disable a single option, so removals of disabled options
// the form already holds are merged back.
export function withPinnedValues(
  next: readonly string[],
  options: readonly SelectOptionEntry[],
  current: readonly string[],
): readonly string[] {
  const missingPinned = options
    .filter(
      (opt) => opt.disabled === true && current.includes(opt.value) && !next.includes(opt.value),
    )
    .map((opt) => opt.value);
  return missingPinned.length === 0 ? next : [...next, ...missingPinned];
}

export function moneyMinorValue(v: unknown, currency: string): number | "" {
  if (v === undefined || v === null || v === "") return "";
  if (typeof v === "number") return Math.round(v * 10 ** currencyDecimals(currency));
  if (typeof v === "object") {
    const amount = propertyOf(v, "amount");
    if (typeof amount === "number") return Math.round(amount * 10 ** currencyDecimals(currency));
  }
  return "";
}

// MoneyInput's minor-units onChange → the server payload shape
// (`z.object({amount, currency})`, schema-builder.ts) — MAJOR units, no
// `amountMinor` (the server derives that itself on write).
export function moneyPayload(minorUnits: number | undefined, currency: string): unknown {
  if (minorUnits === undefined) return undefined;
  return { amount: minorUnits / 10 ** currencyDecimals(currency), currency };
}

// A locatedTimestamp field value is supplied by the read wrapper as
// `{ at, tz, utc }`; an unset value becomes "" as the empty sentinel,
// consistent with money and timestamp fields.
export function locatedValue(v: unknown): { at: string; tz: string; utc?: string } | "" {
  if (v !== null && typeof v === "object" && "at" in v && "tz" in v) {
    const utc = propertyOf(v, "utc");
    return {
      at: typeof v.at === "string" ? v.at : "",
      tz: typeof v.tz === "string" ? v.tz : "",
      ...(typeof utc === "string" && { utc }),
    };
  }
  return "";
}
