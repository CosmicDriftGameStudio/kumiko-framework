import { describe, expect, test } from "bun:test";
import { facetChipCount, facetValueCountsOf } from "../facet-value-counts.ts";

const statusAnswer = {
  groups: [
    { key: "open", count: 7, measures: [] },
    { key: "done", count: 3, measures: [] },
    { key: null, count: 2, measures: [] },
  ],
};

describe("facetValueCountsOf", () => {
  test("sums groups per value and in total, the null group only counts in total", () => {
    const counts = facetValueCountsOf(statusAnswer);
    expect(counts?.byValue.get("open")).toBe(7);
    expect(counts?.byValue.get("done")).toBe(3);
    expect(counts?.byValue.size).toBe(2);
    expect(counts?.total).toBe(12);
  });

  test("a boolean key matches the chip value 'true'", () => {
    const counts = facetValueCountsOf({ groups: [{ key: true, count: 4, measures: [] }] });
    expect(counts?.byValue.get("true")).toBe(4);
  });

  test("a truncated answer has no counts", () => {
    expect(facetValueCountsOf({ ...statusAnswer, truncated: true })).toBeUndefined();
  });

  test("a row answer has no counts", () => {
    expect(facetValueCountsOf({ rows: [], nextCursor: null })).toBeUndefined();
  });
});

describe("facetChipCount", () => {
  const counts = facetValueCountsOf(statusAnswer);
  if (counts === undefined) throw new Error("fixture must parse");

  test("sums the chip's values, each value once", () => {
    expect(facetChipCount(counts, ["open"])).toBe(7);
    expect(facetChipCount(counts, ["open", "done"])).toBe(10);
    expect(facetChipCount(counts, ["open", "open"])).toBe(7);
  });

  test("a chip without values counts every row", () => {
    expect(facetChipCount(counts, [])).toBe(12);
  });

  test("an unknown value counts zero", () => {
    expect(facetChipCount(counts, ["missing"])).toBe(0);
  });
});
