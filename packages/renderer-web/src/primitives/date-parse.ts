// Shared date parse/format utils for the web date primitives (DateInput,
// TimestampInput). PlainDate semantics: pure calendar date, no timezone
// conversion — "2026-04-25" stays the 25th regardless of the browser's
// zone. TZ/wall-clock conversion for timestamp fields deliberately stays
// in timestamp-input.tsx (wire boundary, own test); this file is pure
// calendar date.

import { Temporal } from "temporal-polyfill";

// Prefer the native Temporal (Chromium 144+/Firefox 139+) over the bundled
// polyfill so `instanceof` checks match values crossing package boundaries;
// falls back to the polyfill where native support is absent.
function activeTemporal(): typeof Temporal {
  return (globalThis as unknown as { Temporal?: typeof Temporal }).Temporal ?? Temporal;
}

export function guessLocale(): string {
  if (typeof navigator !== "undefined" && navigator.language) return navigator.language;
  return "en-US";
}

// overflow:"reject" throws on overflow (Feb 31 → RangeError) instead of
// silently rolling it forward — typed dates should not silently shift to
// a different date.
function makePlainDate(y: number, m: number, d: number): Temporal.PlainDate | undefined {
  try {
    return activeTemporal().PlainDate.from({ year: y, month: m, day: d }, { overflow: "reject" });
  } catch {
    return undefined;
  }
}

export function parseIso(v: string): Temporal.PlainDate | undefined {
  if (v === "") return undefined;
  const parts = v.split("-");
  if (parts.length !== 3) return undefined;
  const [y, m, d] = parts.map(Number);
  if (
    y === undefined ||
    m === undefined ||
    d === undefined ||
    Number.isNaN(y) ||
    Number.isNaN(m) ||
    Number.isNaN(d) ||
    // Reject 2-digit years — matches the pre-PlainDate behavior where
    // `new Date`'s 1900+y quirk made a round-trip check fail on them.
    y < 100 ||
    // Reject years outside 0000-9999 — Temporal.toString() switches to the
    // signed extended ISO format above that range (e.g. "+010000-04-25"),
    // breaking the "unchanged ISO string" wire contract (toIso below).
    y > 9999
  ) {
    return undefined;
  }
  return makePlainDate(y, m, d);
}

export function toIso(d: Temporal.PlainDate): string {
  // calendarName: "never" — a non-ISO PlainDate (e.g. from a future
  // PlainDate.from with a `[u-ca=...]` suffix) would otherwise append the
  // calendar annotation to the wire string.
  return d.toString({ calendarName: "never" });
}

// Editable, re-parseable display (numeric locale format, e.g. de
// "25.04.2026", en-US "04/25/2026"). Deliberately NOT month:"long" — the
// user should be able to overwrite the displayed text directly.
export function formatDateForInput(d: Temporal.PlainDate, locale: string): string {
  return d.toLocaleString(locale, { year: "numeric", month: "2-digit", day: "2-digit" });
}

type DateSlot = "y" | "m" | "d";

// Shared by localeDateOrder and formatDatePlaceholder — both need the
// locale's numeric formatToParts breakdown of the same reference date.
// epoch-millis input instead of a Date object (guard-compliant); timeZone:
// "UTC" keeps the reference from shifting to the 1st depending on the
// browser's TZ.
function localeDateParts(locale: string): Intl.DateTimeFormatPart[] {
  const refEpochMillis = activeTemporal()
    .PlainDate.from({ year: 2026, month: 1, day: 2 })
    .toZonedDateTime("UTC").epochMilliseconds;
  return new Intl.DateTimeFormat(locale, {
    timeZone: "UTC",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(refEpochMillis);
}

// Field order of the numeric locale format. de → [d,m,y], en-US →
// [m,d,y], ISO-like locales → [y,m,d].
function localeDateOrder(locale: string): readonly DateSlot[] {
  const order: DateSlot[] = [];
  for (const part of localeDateParts(locale)) {
    if (part.type === "year") order.push("y");
    else if (part.type === "month") order.push("m");
    else if (part.type === "day") order.push("d");
  }
  return order;
}

// Locale-shaped placeholder pattern, e.g. de "TT.MM.JJJJ", en-US
// "MM/DD/YYYY", en-GB "DD/MM/YYYY". Slot order and separator both come
// from formatToParts — nothing hardcoded per locale. `letters` is one
// character per slot (from i18n); repeated to the slot's digit count
// (day/month 2, year 4).
// Clamps each slot letter to its first code point — `letters` normally comes
// from i18n and can fall back to the raw, multi-character translation key
// when a lookup misses, which would otherwise blow up the placeholder length.
function firstCodePoint(s: string): string {
  return [...s][0] ?? "?";
}

export function formatDatePlaceholder(
  locale: string,
  letters: { readonly year: string; readonly month: string; readonly day: string },
): string {
  return localeDateParts(locale)
    .map((part) => {
      if (part.type === "year") return firstCodePoint(letters.year).repeat(4);
      if (part.type === "month") return firstCodePoint(letters.month).repeat(2);
      if (part.type === "day") return firstCodePoint(letters.day).repeat(2);
      return part.value;
    })
    .join("");
}

// Typed input → PlainDate. Accepts ISO (yyyy-mm-dd) directly, plus three
// numeric tokens in locale order with any separator (".", "/", "-", " ").
// Two-digit years → 2000s. Partial/invalid input → undefined (caller
// keeps the raw text then, commits nothing).
export function parseTypedDate(input: string, locale: string): Temporal.PlainDate | undefined {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;

  const iso = parseIso(trimmed);
  if (iso !== undefined) return iso;

  const tokens = trimmed.split(/\D+/).filter((t) => t !== "");
  if (tokens.length !== 3) return undefined;
  const nums = tokens.map(Number);
  if (nums.some(Number.isNaN)) return undefined;

  const order = localeDateOrder(locale);
  if (order.length !== 3) return undefined;

  let y = 0;
  let m = 0;
  let d = 0;
  order.forEach((slot, i) => {
    const val = nums[i] ?? 0;
    if (slot === "y") y = val;
    else if (slot === "m") m = val;
    else d = val;
  });
  if (y < 100) y += 2000;
  if (y > 9999) return undefined;

  return makePlainDate(y, m, d);
}
