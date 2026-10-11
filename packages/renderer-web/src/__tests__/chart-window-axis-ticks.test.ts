import { describe, expect, test } from "bun:test";
import {
  bucketIndexAtFraction,
  stackedAreaAxisTicks,
  stackedAreaDateFormatFor,
} from "../widgets/chart-window.js";

const utc = (year: number, monthIndex: number, day = 1): number => Date.UTC(year, monthIndex, day);
const monthOf = (atMs: number): number => new Date(atMs).getUTCMonth();
const dayOf = (atMs: number): number => new Date(atMs).getUTCDate();

describe("stackedAreaAxisTicks", () => {
  const longWindow = { startMs: utc(2023, 6), endMs: utc(2048, 3) };

  test("25 years with 12 labels: January ticks within budget", () => {
    const ticks = stackedAreaAxisTicks(longWindow, 12, "month");
    expect(ticks.length).toBeGreaterThan(2);
    expect(ticks.length).toBeLessThanOrEqual(10);
    for (const tick of ticks) {
      expect(monthOf(tick)).toBe(0);
      expect(dayOf(tick)).toBe(1);
    }
  });

  const windows = {
    "25 years": longWindow,
    "5 years": { startMs: utc(2026, 4, 12), endMs: utc(2031, 4, 12) },
    "14 months": { startMs: utc(2026, 2, 15), endMs: utc(2027, 4, 20) },
    "under a month": { startMs: utc(2026, 2, 3), endMs: utc(2026, 2, 25) },
  } as const;

  for (const [name, window] of Object.entries(windows)) {
    for (const maxLabels of [4, 7, 12]) {
      test(`${name} with ${maxLabels} labels keeps one label slot between inner neighbours and 1.5 to the edges`, () => {
        const ticks = stackedAreaAxisTicks(window, maxLabels, stackedAreaDateFormatFor(window));
        const positions = [window.startMs, ...ticks, window.endMs];
        const slot = (window.endMs - window.startMs) / maxLabels;
        expect(ticks.length).toBeLessThanOrEqual(maxLabels - 2);
        for (let i = 1; i < positions.length; i++) {
          const touchesEdge = i === 1 || i === positions.length - 1;
          const minGap = touchesEdge ? slot * 1.5 : slot;
          expect((positions[i] ?? 0) - (positions[i - 1] ?? 0)).toBeGreaterThanOrEqual(minGap);
        }
      });
    }
  }

  test("25 years with 4 labels leaves at most two inner ticks", () => {
    expect(stackedAreaAxisTicks(longWindow, 4, "month").length).toBeLessThanOrEqual(2);
  });

  test("ticks are strictly inside the window and ascending", () => {
    const ticks = stackedAreaAxisTicks(longWindow, 7, "month");
    expect([...ticks].sort((a, b) => a - b)).toEqual([...ticks]);
    expect(ticks.every((t) => t > longWindow.startMs && t < longWindow.endMs)).toBe(true);
  });

  test("a 12 month window in day format ticks on month starts", () => {
    const window = { startMs: utc(2026, 2, 15), endMs: utc(2027, 2, 15) };
    const ticks = stackedAreaAxisTicks(window, 12, "day");
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(ticks.every((t) => dayOf(t) === 1)).toBe(true);
  });

  test("a 6 week window in day format uses day steps", () => {
    const window = { startMs: utc(2026, 2, 3), endMs: utc(2026, 3, 14) };
    const ticks = stackedAreaAxisTicks(window, 12, "day");
    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThanOrEqual(10);
    expect(ticks.every((t) => t > window.startMs && t < window.endMs)).toBe(true);
  });

  test("a window under one month in month format has no ticks", () => {
    const window = { startMs: utc(2026, 2, 3), endMs: utc(2026, 2, 20) };
    expect(stackedAreaAxisTicks(window, 12, "month")).toEqual([]);
  });

  test("an empty window has no ticks", () => {
    expect(stackedAreaAxisTicks({ startMs: 5, endMs: 5 }, 12, "month")).toEqual([]);
  });
});

describe("bucketIndexAtFraction", () => {
  const times = [0, 10, 20, 40];
  const window = { startMs: 0, endMs: 40 };

  test("maps a fraction to the nearest bucket", () => {
    expect(bucketIndexAtFraction(times, window, 0)).toBe(0);
    expect(bucketIndexAtFraction(times, window, 0.3)).toBe(1);
    expect(bucketIndexAtFraction(times, window, 0.6)).toBe(2);
    expect(bucketIndexAtFraction(times, window, 0.95)).toBe(3);
  });

  test("clamps fractions outside 0..1", () => {
    expect(bucketIndexAtFraction(times, window, -2)).toBe(0);
    expect(bucketIndexAtFraction(times, window, 5)).toBe(3);
  });
});
