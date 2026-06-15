// date-parse Pure-Logik Tests. parseIso pinnt das non-obvious Timezone-
// Verhalten (baut ein LOKALES Date, nicht UTC, damit "2026-04-25" im
// Calendar nicht je nach Zeitzone auf den 24. kippt). parseTypedDate deckt
// die getippte Eingabe ab (#369): locale-Reihenfolge, Trenner-Toleranz,
// Überlauf-Abweisung.

import { describe, expect, test } from "bun:test";
import { formatDateForInput, parseIso, parseTypedDate, toIso } from "../date-parse";

describe("parseIso", () => {
  test("gültiges yyyy-mm-dd → lokales Date (kein UTC-Shift)", () => {
    const d = parseIso("2026-04-25");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getFullYear()).toBe(2026);
    expect(d?.getMonth()).toBe(3); // 0-based: April
    expect(d?.getDate()).toBe(25);
  });

  test("leerer String → undefined", () => {
    expect(parseIso("")).toBeUndefined();
  });

  test("falsche Teil-Anzahl oder nicht-numerische Teile → undefined", () => {
    expect(parseIso("2026-04")).toBeUndefined();
    expect(parseIso("2026/04/25")).toBeUndefined();
    expect(parseIso("abc-de-fg")).toBeUndefined();
  });

  test("ungültiger Kalendertag (Überlauf) → undefined", () => {
    expect(parseIso("2026-02-31")).toBeUndefined();
    expect(parseIso("2026-13-01")).toBeUndefined();
  });
});

describe("toIso", () => {
  test("Date → yyyy-mm-dd mit Zero-Padding", () => {
    expect(toIso(new Date(2026, 3, 5))).toBe("2026-04-05");
    expect(toIso(new Date(2026, 11, 25))).toBe("2026-12-25");
  });

  test("Roundtrip parseIso → toIso ist stabil", () => {
    const d = parseIso("2026-04-25");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });
});

describe("parseTypedDate", () => {
  test("ISO direkt getippt → Date", () => {
    expect(toIso(parseTypedDate("2026-04-25", "de-DE") as Date)).toBe("2026-04-25");
  });

  test("de-DE Reihenfolge d.m.y", () => {
    const d = parseTypedDate("25.04.2026", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("en-US Reihenfolge m/d/y", () => {
    const d = parseTypedDate("04/25/2026", "en-US");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("Trenner-Toleranz (gemischte Nicht-Ziffern)", () => {
    const d = parseTypedDate("25 4 2026", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("zweistelliges Jahr → 2000er", () => {
    const d = parseTypedDate("25.04.26", "de-DE");
    expect(d).toBeDefined();
    if (d !== undefined) expect(toIso(d)).toBe("2026-04-25");
  });

  test("Teil-/Fehl-Eingabe → undefined", () => {
    expect(parseTypedDate("", "de-DE")).toBeUndefined();
    expect(parseTypedDate("25.04", "de-DE")).toBeUndefined();
    expect(parseTypedDate("foo", "de-DE")).toBeUndefined();
    expect(parseTypedDate("32.04.2026", "de-DE")).toBeUndefined();
  });
});

describe("formatDateForInput", () => {
  test("numerisch, locale-spezifisch, wieder parsebar", () => {
    const formatted = formatDateForInput(new Date(2026, 3, 25), "de-DE");
    const roundtrip = parseTypedDate(formatted, "de-DE");
    expect(roundtrip).toBeDefined();
    if (roundtrip !== undefined) expect(toIso(roundtrip)).toBe("2026-04-25");
  });
});
