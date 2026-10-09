import { describe, expect, test } from "bun:test";
import {
  addUtcMonths,
  initialWindowSelection,
  resolveStackedAreaWindow,
  type StackedAreaRanges,
  snapBrushWindow,
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
