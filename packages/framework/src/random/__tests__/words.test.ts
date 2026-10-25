// words.ts invariant tests.
//
// Protects the slug word lists from faulty edits (duplicates,
import { ADJECTIVES, NOUNS } from "../words.ts";

// uppercase letters, hyphens, garbage entries). Deliberately NOT tied to
// the outdated inline comments ("150 × 150", "4-8 Buchstaben") —
// there are actually more words and additional lengths; these tests cover
// the genuine hard invariants and the documented minimum diversity.

import { describe, expect, test } from "bun:test";

const LISTS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["ADJECTIVES", ADJECTIVES],
  ["NOUNS", NOUNS],
];

describe("words — Slug-Wortlisten Invarianten", () => {
  for (const [name, list] of LISTS) {
    describe(name, () => {
      test("lowercase a-z only (no digits, hyphens, whitespace, or umlauts)", () => {
        const offenders = list.filter((w) => !/^[a-z]+$/.test(w));
        expect(offenders).toEqual([]);
      });

      test("no duplicates", () => {
        const dupes = list.filter((w, i) => list.indexOf(w) !== i);
        expect(dupes).toEqual([]);
      });

      test("at least 150 words (lower bound for combo diversity)", () => {
        expect(list.length).toBeGreaterThanOrEqual(150);
      });

      test("word length within the garbage-protection range 3..12 (catches empty/sentence entries)", () => {
        const outliers = list.filter((w) => w.length < 3 || w.length > 12);
        expect(outliers).toEqual([]);
      });
    });
  }

  test("produces ≥ 22,500 clean combinations (documented minimum diversity)", () => {
    expect(ADJECTIVES.length * NOUNS.length).toBeGreaterThanOrEqual(22_500);
  });
});
