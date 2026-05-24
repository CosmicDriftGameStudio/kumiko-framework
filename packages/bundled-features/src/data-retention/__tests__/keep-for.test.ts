import { ensureTemporalPolyfill, getTemporal } from "@cosmicdrift/kumiko-framework/time";
import { beforeAll, describe, expect, test } from "bun:test";
import { computeCutoff, InvalidKeepForError, isPastCutoff } from "../keep-for";

beforeAll(async () => {
  await ensureTemporalPolyfill();
});

// Funktion statt const — Temporal ist erst nach beforeAll verfuegbar.
function now() {
  return getTemporal().Instant.from("2026-05-07T12:00:00Z");
}

describe("computeCutoff", () => {
  test("30d → 30 Tage zurück", () => {
    const cutoff = computeCutoff("30d", now());
    expect(cutoff.toString()).toBe("2026-04-07T12:00:00Z");
  });

  test("24h → 24 Stunden zurück", () => {
    const cutoff = computeCutoff("24h", now());
    expect(cutoff.toString()).toBe("2026-05-06T12:00:00Z");
  });

  test("1w → 7 Tage zurück", () => {
    const cutoff = computeCutoff("1w", now());
    expect(cutoff.toString()).toBe("2026-04-30T12:00:00Z");
  });

  test("6m → 180 Tage zurück (Approximation)", () => {
    const cutoff = computeCutoff("6m", now());
    expect(cutoff.toString()).toBe("2025-11-08T12:00:00Z");
  });

  test("10y → 3650 Tage zurück", () => {
    const cutoff = computeCutoff("10y", now());
    // Approximation: 10×365=3650 Tage. Differenz zu echtem Datum durch
    // Schaltjahre: ~2-3 Tage. Akzeptabel für Retention-Cleanup.
    expect(cutoff.toString()).toBe("2016-05-09T12:00:00Z");
  });

  test("0d → now (Edge-Case, akzeptiert)", () => {
    const cutoff = computeCutoff("0d", now());
    expect(cutoff.toString()).toBe(now().toString());
  });

  test("invalid format wirft InvalidKeepForError", () => {
    expect(() => computeCutoff("30days", now())).toThrow(InvalidKeepForError);
    expect(() => computeCutoff("abc", now())).toThrow(InvalidKeepForError);
    expect(() => computeCutoff("", now())).toThrow(InvalidKeepForError);
    expect(() => computeCutoff("30", now())).toThrow(InvalidKeepForError);
  });
});

describe("isPastCutoff", () => {
  test("Row 31 Tage alt + keepFor 30d + now jetzt → past cutoff (true)", () => {
    const past = now().subtract({ hours: 31 * 24 });
    expect(isPastCutoff({ referenceTimestamp: past, keepFor: "30d", now: now() })).toBe(true);
  });

  test("Row 29 Tage alt + keepFor 30d → noch nicht abgelaufen (false)", () => {
    const recent = now().subtract({ hours: 29 * 24 });
    expect(isPastCutoff({ referenceTimestamp: recent, keepFor: "30d", now: now() })).toBe(false);
  });

  test("Row exakt am Cutoff → false (strict less-than-Check)", () => {
    const exact = now().subtract({ hours: 30 * 24 });
    expect(isPastCutoff({ referenceTimestamp: exact, keepFor: "30d", now: now() })).toBe(false);
  });

  test("Row 11 Jahre alt + keepFor 10y → past (Aufbewahrungspflicht abgelaufen)", () => {
    const elevenYearsAgo = now().subtract({ hours: 11 * 365 * 24 });
    expect(isPastCutoff({ referenceTimestamp: elevenYearsAgo, keepFor: "10y", now: now() })).toBe(
      true,
    );
  });
});
