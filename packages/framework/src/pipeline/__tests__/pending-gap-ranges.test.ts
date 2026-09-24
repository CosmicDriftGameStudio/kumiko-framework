import { describe, expect, test } from "bun:test";
import type { PendingGapEntry } from "../event-consumer-state";
import { capPendingGapsBelowCursor, subtractSortedIdsFromRanges } from "../pending-gap-ranges";

function gap(from: string, to: string, xmax = "100"): PendingGapEntry {
  return { from, to, xmax };
}

describe("subtractSortedIdsFromRanges", () => {
  test("no ids leaves ranges unchanged", () => {
    const ranges = [gap("10", "20")];
    expect(subtractSortedIdsFromRanges(ranges, [])).toEqual([gap("10", "20")]);
  });

  test("id in the middle of a range splits it in two", () => {
    const ranges = [gap("10", "20")];
    expect(subtractSortedIdsFromRanges(ranges, [15n])).toEqual([gap("10", "14"), gap("16", "20")]);
  });

  test("ids at from- and to-boundary shrink the range from inside", () => {
    const ranges = [gap("10", "20")];
    expect(subtractSortedIdsFromRanges(ranges, [10n, 20n])).toEqual([gap("11", "19")]);
  });

  test("all ids of a range make it disappear", () => {
    const ranges = [gap("10", "12")];
    expect(subtractSortedIdsFromRanges(ranges, [10n, 11n, 12n])).toEqual([]);
  });

  test("ids between, before and after ranges affect nothing", () => {
    const ranges = [gap("10", "20"), gap("30", "40")];
    expect(subtractSortedIdsFromRanges(ranges, [5n, 25n, 45n])).toEqual([
      gap("10", "20"),
      gap("30", "40"),
    ]);
  });

  test("multiple ranges with ids spread across them use a single pointer pass", () => {
    const ranges = [gap("10", "20"), gap("30", "40"), gap("50", "60")];
    const ids = [15n, 30n, 40n, 55n];
    expect(subtractSortedIdsFromRanges(ranges, ids)).toEqual([
      gap("10", "14"),
      gap("16", "20"),
      gap("31", "39"),
      gap("50", "54"),
      gap("56", "60"),
    ]);
  });

  test("xmax is preserved on every surviving part", () => {
    const ranges = [gap("10", "20", "999")];
    expect(subtractSortedIdsFromRanges(ranges, [15n])).toEqual([
      gap("10", "14", "999"),
      gap("16", "20", "999"),
    ]);
  });
});

describe("capPendingGapsBelowCursor", () => {
  test("cursor 0n caps everything away", () => {
    const ranges = [gap("10", "20")];
    expect(capPendingGapsBelowCursor(ranges, 0n)).toEqual([]);
  });

  test("range fully below cursor is unchanged", () => {
    const ranges = [gap("10", "20")];
    expect(capPendingGapsBelowCursor(ranges, 100n)).toEqual([gap("10", "20")]);
  });

  test("range straddling the cursor is truncated to cursor - 1", () => {
    const ranges = [gap("10", "20")];
    expect(capPendingGapsBelowCursor(ranges, 15n)).toEqual([gap("10", "14")]);
  });

  test("range with to == cursor is truncated to cursor - 1", () => {
    const ranges = [gap("10", "20")];
    expect(capPendingGapsBelowCursor(ranges, 20n)).toEqual([gap("10", "19")]);
  });

  test("range with from == cursor is dropped entirely", () => {
    const ranges = [gap("20", "30")];
    expect(capPendingGapsBelowCursor(ranges, 20n)).toEqual([]);
  });

  test("range with from > cursor is dropped entirely", () => {
    const ranges = [gap("25", "30")];
    expect(capPendingGapsBelowCursor(ranges, 20n)).toEqual([]);
  });

  test("xmax is preserved on surviving ranges", () => {
    const ranges = [gap("10", "20", "777")];
    expect(capPendingGapsBelowCursor(ranges, 15n)).toEqual([gap("10", "14", "777")]);
  });
});
