// words.ts Invarianten-Tests (Phase 1, test-luecken-integration).
//
// Schützt die Slug-Wortlisten gegen fehlerhafte Edits (Duplikate,
// Großbuchstaben, Bindestriche, Müll-Einträge). Bewusst NICHT an die
// veralteten Inline-Kommentare gebunden ("150 × 150", "4-8 Buchstaben") —
// real sind es mehr Wörter und weitere Längen; getestet werden die echten
// harten Invarianten + die dokumentierte Mindest-Diversität.

import { describe, expect, test } from "bun:test";
import { ADJECTIVES, NOUNS } from "../index";

const LISTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ADJECTIVES", ADJECTIVES],
  ["NOUNS", NOUNS],
];

describe("words — Slug-Wortlisten Invarianten", () => {
  for (const [name, list] of LISTS) {
    describe(name, () => {
      test("nur lowercase a-z (keine Ziffern, Bindestriche, Whitespace, Umlaute)", () => {
        const offenders = list.filter((w) => !/^[a-z]+$/.test(w));
        expect(offenders).toEqual([]);
      });

      test("keine Duplikate", () => {
        const dupes = list.filter((w, i) => list.indexOf(w) !== i);
        expect(dupes).toEqual([]);
      });

      test("mindestens 150 Wörter (untere Schranke für Combo-Diversität)", () => {
        expect(list.length).toBeGreaterThanOrEqual(150);
      });

      test("Wortlänge im Müll-Schutz-Korridor 3..12 (fängt leere/Satz-Einträge)", () => {
        const outliers = list.filter((w) => w.length < 3 || w.length > 12);
        expect(outliers).toEqual([]);
      });
    });
  }

  test("ergibt ≥ 22.500 saubere Kombinationen (dokumentierte Mindest-Diversität)", () => {
    expect(ADJECTIVES.length * NOUNS.length).toBeGreaterThanOrEqual(22_500);
  });
});
