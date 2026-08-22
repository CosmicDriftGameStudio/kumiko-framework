// date-parse pure logic tests. parseIso pins the non-obvious timezone
// behavior (PlainDate has no TZ conversion, so "2026-04-25" doesn't shift
// to the 24th in the calendar depending on the zone). parseTypedDate
// covers typed input (#369): locale order, separator tolerance, overflow
// rejection.

import { describe, expect, test } from "bun:test";
import { localeDeBundle } from "@cosmicdrift/kumiko-locale-de";
import { kumikoDefaultTranslations } from "@cosmicdrift/kumiko-renderer";
import { Temporal } from "temporal-polyfill";
import {
  formatDateForInput,
  formatDatePlaceholder,
  parseIso,
  parseTypedDate,
  toIso,
} from "../date-parse";

// Derived from kumikoDefaultTranslations instead of hardcoded so a drift in
// the i18n defaults (e.g. renaming "T" → "D") fails this test too.
function placeholderLetters(locale: "de" | "en"): { year: string; month: string; day: string } {
  const bundle = locale === "de" ? localeDeBundle : kumikoDefaultTranslations[locale];
  return {
    year: bundle?.["kumiko.field.dateField.placeholderYear"] ?? "",
    month: bundle?.["kumiko.field.dateField.placeholderMonth"] ?? "",
    day: bundle?.["kumiko.field.dateField.placeholderDay"] ?? "",
  };
}

const dePlaceholderLetters = placeholderLetters("de");
const enPlaceholderLetters = placeholderLetters("en");

describe("parseIso", () => {
  test("valid yyyy-mm-dd → PlainDate (no TZ conversion)", () => {
    const d = parseIso("2026-04-25");
    expect(d).toEqual(Temporal.PlainDate.from("2026-04-25"));
    expect(d?.year).toBe(2026);
    expect(d?.month).toBe(4);
    expect(d?.day).toBe(25);
  });

  test("empty string → undefined", () => {
    expect(parseIso("")).toBeUndefined();
  });

  test("wrong part count or non-numeric parts → undefined", () => {
    expect(parseIso("2026-04")).toBeUndefined();
    expect(parseIso("2026/04/25")).toBeUndefined();
    expect(parseIso("abc-de-fg")).toBeUndefined();
  });

  test("invalid calendar day (overflow) → undefined", () => {
    expect(parseIso("2026-02-31")).toBeUndefined();
    expect(parseIso("2026-13-01")).toBeUndefined();
  });

  test("year below 100 → undefined (no 1900+y fallback)", () => {
    expect(parseIso("0026-04-25")).toBeUndefined();
    expect(parseIso("26-04-25")).toBeUndefined();
  });

  test("year above 9999 → undefined (Temporal.toString() would switch to signed extended ISO)", () => {
    expect(parseIso("10000-04-25")).toBeUndefined();
    expect(parseIso("999999-04-25")).toBeUndefined();
  });

  test("year 9999 is still accepted (upper boundary)", () => {
    const d = parseIso("9999-04-25");
    expect(d).toBeDefined();
    expect(toIso(d as Temporal.PlainDate)).toBe("9999-04-25");
  });
});

describe("toIso", () => {
  test("PlainDate → yyyy-mm-dd with zero padding", () => {
    expect(toIso(Temporal.PlainDate.from({ year: 2026, month: 4, day: 5 }))).toBe("2026-04-05");
    expect(toIso(Temporal.PlainDate.from({ year: 2026, month: 12, day: 25 }))).toBe("2026-12-25");
  });

  test("roundtrip parseIso → toIso is stable", () => {
    const d = parseIso("2026-04-25");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });
});

describe("parseTypedDate", () => {
  test("ISO typed directly → PlainDate", () => {
    expect(toIso(parseTypedDate("2026-04-25", "de-DE") as Temporal.PlainDate)).toBe("2026-04-25");
  });

  test("de-DE order d.m.y", () => {
    const d = parseTypedDate("25.04.2026", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("en-US order m/d/y", () => {
    const d = parseTypedDate("04/25/2026", "en-US");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("separator tolerance (mixed non-digits)", () => {
    const d = parseTypedDate("25 4 2026", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("two-digit year → 2000s", () => {
    const d = parseTypedDate("25.04.26", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("six-digit year → undefined, not a signed extended-ISO wire value", () => {
    expect(parseTypedDate("25.04.999999", "de-DE")).toBeUndefined();
  });

  test("partial/invalid input → undefined", () => {
    expect(parseTypedDate("", "de-DE")).toBeUndefined();
    expect(parseTypedDate("25.04", "de-DE")).toBeUndefined();
    expect(parseTypedDate("foo", "de-DE")).toBeUndefined();
    expect(parseTypedDate("32.04.2026", "de-DE")).toBeUndefined();
  });
});

describe("formatDateForInput", () => {
  test("numeric, locale-specific, re-parseable", () => {
    const formatted = formatDateForInput(
      Temporal.PlainDate.from({ year: 2026, month: 4, day: 25 }),
      "de-DE",
    );
    const roundtrip = parseTypedDate(formatted, "de-DE");
    expect(roundtrip).toBeDefined();
    if (roundtrip !== undefined) expect(toIso(roundtrip)).toBe("2026-04-25");
  });

  test("en-US locale, re-parseable", () => {
    const formatted = formatDateForInput(
      Temporal.PlainDate.from({ year: 2026, month: 4, day: 25 }),
      "en-US",
    );
    const roundtrip = parseTypedDate(formatted, "en-US");
    expect(roundtrip).toBeDefined();
    if (roundtrip !== undefined) expect(toIso(roundtrip)).toBe("2026-04-25");
  });

  // #1659: y/m/d locale branch of localeDateOrder (ISO-like)
  test("ja-JP locale (y/m/d order), re-parseable", () => {
    const formatted = formatDateForInput(
      Temporal.PlainDate.from({ year: 2026, month: 4, day: 25 }),
      "ja-JP",
    );
    const roundtrip = parseTypedDate(formatted, "ja-JP");
    expect(roundtrip).toBeDefined();
    if (roundtrip !== undefined) expect(toIso(roundtrip)).toBe("2026-04-25");
  });
});

// #1865: placeholder shows the locale's format pattern, not a hardcoded
// example date that reads as an already-filled-in value.
describe("formatDatePlaceholder", () => {
  test("de-DE → day.month.year pattern with dot separator", () => {
    expect(formatDatePlaceholder("de-DE", dePlaceholderLetters)).toBe("TT.MM.JJJJ");
  });

  test("en-US → month/day/year pattern with slash separator", () => {
    expect(formatDatePlaceholder("en-US", enPlaceholderLetters)).toBe("MM/DD/YYYY");
  });

  test("en-GB → day/month/year pattern with slash separator", () => {
    expect(formatDatePlaceholder("en-GB", enPlaceholderLetters)).toBe("DD/MM/YYYY");
  });

  // #1879: a missing i18n key falls back to the raw, multi-character key
  // string (see i18n.tsx) — the placeholder must clamp to one char per slot
  // instead of repeating the whole fallback key.
  test("multi-character letters (e.g. raw i18n fallback key) clamp to first code point", () => {
    const rawKeyLetters = {
      year: "kumiko.field.dateField.placeholderYear",
      month: "kumiko.field.dateField.placeholderMonth",
      day: "kumiko.field.dateField.placeholderDay",
    };
    expect(formatDatePlaceholder("de-DE", rawKeyLetters)).toBe("kk.kk.kkkk");
  });
});
