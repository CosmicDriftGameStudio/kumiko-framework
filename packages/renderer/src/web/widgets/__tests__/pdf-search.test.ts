import { describe, expect, test } from "bun:test";
import { clampPage, findMatches, findTextMatches, mostVisiblePage } from "../pdf-search.ts";

describe("findTextMatches", () => {
  test("finds case-insensitive, non-overlapping occurrences", () => {
    expect(findTextMatches(["Heizung kalt, heizung defekt, HEIZUNG"], "heizung")).toHaveLength(3);
    expect(findTextMatches(["aaaa"], "aa")).toHaveLength(2);
  });

  test("empty term and missing text give no match", () => {
    expect(findTextMatches(["Heizung"], "")).toEqual([]);
    expect(findTextMatches(["Heizung"], "  ")).toEqual([]);
    expect(findTextMatches(["Heizung"], "Wasser")).toEqual([]);
  });

  test("a phrase spanning several items yields one segment per item", () => {
    const items = ["(1) Die Kaution beträgt drei", "Nettokaltmieten, also", " ", "2.850,00 €."];
    expect(findTextMatches(items, "Kaution beträgt drei Nettokaltmieten, also 2.850,00")).toEqual([
      [
        { item: 0, start: 8, end: 28 },
        { item: 1, start: 0, end: 21 },
        { item: 3, start: 0, end: 8 },
      ],
    ]);
  });
});

describe("findMatches", () => {
  test("assigns each occurrence to its page with a per-page ordinal", () => {
    const pages = [["Techem Energy", "Heizkosten Heizung"], ["nichts"], ["Heizung", "Heizung"]];
    expect(findMatches(pages, "heiz")).toEqual([
      { page: 1, ordinalOnPage: 0 },
      { page: 1, ordinalOnPage: 1 },
      { page: 3, ordinalOnPage: 0 },
      { page: 3, ordinalOnPage: 1 },
    ]);
  });

  test("no hits gives an empty list", () => {
    expect(findMatches([["a"], ["b"]], "x")).toEqual([]);
  });
});

describe("clampPage", () => {
  test("keeps the page inside 1..pageCount and survives garbage", () => {
    expect(clampPage(0, 60)).toBe(1);
    expect(clampPage(99, 60)).toBe(60);
    expect(clampPage(4.4, 60)).toBe(4);
    expect(clampPage(Number.NaN, 60)).toBe(1);
  });
});

describe("mostVisiblePage", () => {
  test("picks the page with the largest visible share, lower page on a tie", () => {
    expect(
      mostVisiblePage(
        new Map([
          [3, 0.4],
          [4, 0.9],
          [5, 0.9],
        ]),
      ),
    ).toBe(4);
  });

  test("nothing visible gives null", () => {
    expect(mostVisiblePage(new Map([[1, 0]]))).toBeNull();
    expect(mostVisiblePage(new Map())).toBeNull();
  });
});
