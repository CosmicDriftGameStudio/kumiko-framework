// date-input Pure-Logik Tests (Phase 1, test-luecken-integration, Tier 1).
//
// parseIso/toIso aus date-input.tsx (exportiert für Test). Pinst das
// non-obvious Timezone-Verhalten: parseIso baut ein LOKALES Date (nicht
// UTC), damit "2026-04-25" im Calendar nicht je nach Zeitzone auf den
// 24. kippt.

import { describe, expect, test } from "bun:test";
import { parseIso, toIso } from "../date-input";

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
