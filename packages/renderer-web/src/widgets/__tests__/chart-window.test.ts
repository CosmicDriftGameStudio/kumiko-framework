import { describe, expect, test } from "bun:test";
import {
  addUtcMonths,
  initialWindowSelection,
  rangeWindow,
  resolveStackedAreaWindow,
  type StackedAreaRanges,
  snapBrushWindow,
  snapMovedBrushWindow,
  stackedAreaDateFormatFor,
} from "../chart-window.js";

const monthAt = (index: number): number => Date.UTC(2026, index, 1);
const buckets = Array.from({ length: 60 }, (_, i) => monthAt(i));
const firstMs = monthAt(0);
const lastMs = monthAt(59);
const fullWindow = { startMs: firstMs, endMs: lastMs };

const ranges: StackedAreaRanges = {
  default: "1y",
  options: [
    { value: "1y", label: "1y", months: 12 },
    { value: "max", label: "max" },
  ],
};

const resolve = (
  overrides: Partial<Parameters<typeof resolveStackedAreaWindow>[0]> = {},
): { startMs: number; endMs: number } =>
  resolveStackedAreaWindow({
    selection: undefined,
    ranges,
    brush: false,
    todayMs: undefined,
    bucketTimes: buckets,
    fullWindow,
    ...overrides,
  });

describe("resolveStackedAreaWindow", () => {
  test("a range anchors at today when the data reaches further", () => {
    const todayMs = monthAt(20);
    expect(resolve({ selection: { kind: "range", value: "1y" }, todayMs })).toEqual({
      startMs: todayMs,
      endMs: monthAt(32),
    });
  });

  test("a range is pulled back at the end of the data", () => {
    expect(resolve({ selection: { kind: "range", value: "1y" }, todayMs: monthAt(55) })).toEqual({
      startMs: monthAt(47),
      endMs: lastMs,
    });
  });

  test("without todayMs the range anchors at the last bucket", () => {
    expect(resolve({ selection: { kind: "range", value: "1y" } })).toEqual({
      startMs: monthAt(47),
      endMs: lastMs,
    });
  });

  test("an option without months shows the full window", () => {
    expect(resolve({ selection: { kind: "range", value: "max" }, todayMs: monthAt(20) })).toEqual(
      fullWindow,
    );
  });

  test("a brush selection is clamped to the buckets", () => {
    expect(
      resolve({
        selection: { kind: "brush", startMs: firstMs - 1000, endMs: lastMs + 1000 },
      }),
    ).toEqual(fullWindow);
  });

  test("brush without ranges starts at today", () => {
    expect(resolve({ ranges: undefined, brush: true, todayMs: monthAt(10) })).toEqual({
      startMs: monthAt(10),
      endMs: lastMs,
    });
  });

  test("brush without ranges shows everything when today is not before the last bucket", () => {
    expect(resolve({ ranges: undefined, brush: true, todayMs: lastMs })).toEqual(fullWindow);
    expect(resolve({ ranges: undefined, brush: true })).toEqual(fullWindow);
  });

  test("no selection, no brush keeps the full window", () => {
    expect(resolve({ todayMs: monthAt(20) })).toEqual(fullWindow);
  });
});

describe("initialWindowSelection", () => {
  test("selects the default range, or nothing without ranges", () => {
    expect(initialWindowSelection(ranges)).toEqual({ kind: "range", value: "1y" });
    expect(initialWindowSelection(undefined)).toBeUndefined();
  });

  test("from-today wins over the default range", () => {
    expect(initialWindowSelection(ranges, "from-today")).toEqual({ kind: "from-today" });
    expect(initialWindowSelection(undefined, "from-today")).toEqual({ kind: "from-today" });
    expect(initialWindowSelection(ranges, "default-range")).toEqual({ kind: "range", value: "1y" });
  });
});

describe("resolveStackedAreaWindow from-today", () => {
  const selection = { kind: "from-today" } as const;
  test("starts at today when it lies inside the data", () => {
    const todayMs = monthAt(20);
    expect(resolve({ selection, todayMs })).toEqual({ startMs: todayMs, endMs: lastMs });
  });
  test("shows everything when today is after the data or unknown", () => {
    expect(resolve({ selection, todayMs: monthAt(80) })).toEqual(fullWindow);
    expect(resolve({ selection, todayMs: undefined })).toEqual(fullWindow);
  });
});

describe("stackedAreaDateFormatFor", () => {
  test("switches to month and year at exactly 18 months", () => {
    const startMs = monthAt(0);
    expect(stackedAreaDateFormatFor({ startMs, endMs: addUtcMonths(startMs, 18) - 1 })).toBe("day");
    expect(stackedAreaDateFormatFor({ startMs, endMs: addUtcMonths(startMs, 18) })).toBe("month");
    expect(stackedAreaDateFormatFor({ startMs, endMs: addUtcMonths(startMs, 300) })).toBe("month");
  });
});

describe("snapBrushWindow", () => {
  const times = [monthAt(0), monthAt(1), monthAt(2), monthAt(3)];

  test("snaps both edges to the nearest bucket", () => {
    expect(snapBrushWindow(times, monthAt(0) + 1000, monthAt(3) - 1000)).toEqual({
      startMs: monthAt(0),
      endMs: monthAt(3),
    });
  });

  test("keeps one bucket between the edges, moving the edge that is not held", () => {
    expect(snapBrushWindow(times, monthAt(2), monthAt(2), "start")).toEqual({
      startMs: monthAt(2),
      endMs: monthAt(3),
    });
    expect(snapBrushWindow(times, monthAt(2), monthAt(2), "end")).toEqual({
      startMs: monthAt(1),
      endMs: monthAt(2),
    });
    expect(snapBrushWindow(times, monthAt(3), monthAt(3), "start")).toEqual({
      startMs: monthAt(2),
      endMs: monthAt(3),
    });
  });
});

describe("snapMovedBrushWindow", () => {
  // Month buckets are 28 to 31 days apart, so independent edge snapping can resize the window.
  const times = Array.from({ length: 12 }, (_, i) => monthAt(i));

  test("keeps the width in buckets constant while only the start snaps", () => {
    const originStartMs = monthAt(2);
    const originEndMs = monthAt(5);
    for (let shiftDays = 0; shiftDays <= 200; shiftDays += 7) {
      const moved = snapMovedBrushWindow(times, originStartMs, originEndMs, shiftDays * 86_400_000);
      const startIndex = times.indexOf(moved.startMs);
      const endIndex = times.indexOf(moved.endMs);
      expect(startIndex).toBeGreaterThanOrEqual(0);
      expect(endIndex - startIndex).toBe(3);
    }
  });

  test("stops at the last bucket instead of shrinking", () => {
    expect(snapMovedBrushWindow(times, monthAt(2), monthAt(5), 400 * 86_400_000)).toEqual({
      startMs: monthAt(8),
      endMs: monthAt(11),
    });
  });
});

describe("rangeWindow", () => {
  test("an anchor so far before the data that the window ends ahead of it shows the full window", () => {
    expect(rangeWindow(12, monthAt(-30), firstMs, lastMs)).toEqual({
      startMs: firstMs,
      endMs: lastMs,
    });
  });

  test("a window never starts after it ends", () => {
    const window = rangeWindow(12, monthAt(-12), firstMs, lastMs);
    expect(window.startMs).toBeLessThanOrEqual(window.endMs);
  });

  test("month-end anchors constrain to the last day of the shorter month", () => {
    expect(addUtcMonths(Date.UTC(2026, 0, 31), 1)).toBe(Date.UTC(2026, 1, 28));
  });
});
