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

// Field order of the numeric locale format. de → [d,m,y], en-US →
// [m,d,y], ISO-like locales → [y,m,d]. formatToParts runs over an epoch-
// millis number instead of a Date object (guard-compliant) — timeZone:
// "UTC" keeps the reference from shifting to the 1st depending on the
// browser's TZ.
function localeDateOrder(locale: string): readonly DateSlot[] {
  const refEpochMillis = activeTemporal()
    .PlainDate.from({ year: 2026, month: 1, day: 2 })
    .toZonedDateTime("UTC").epochMilliseconds;
  const order: DateSlot[] = [];
  for (const part of new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).formatToParts(
    refEpochMillis,
  )) {
    if (part.type === "year") order.push("y");
    else if (part.type === "month") order.push("m");
    else if (part.type === "day") order.push("d");
  }
  return order;
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
