import { describe, expect, test } from "bun:test";
import { clampPage, countMatches, findMatches, mostVisiblePage } from "../pdf-search.ts";

describe("countMatches", () => {
  test("counts case-insensitive, non-overlapping occurrences", () => {
    expect(countMatches("Heizung kalt, heizung defekt, HEIZUNG", "heizung")).toBe(3);
    expect(countMatches("aaaa", "aa")).toBe(2);
  });

  test("empty term and missing text give zero", () => {
    expect(countMatches("Heizung", "")).toBe(0);
    expect(countMatches("Heizung", "Wasser")).toBe(0);
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
