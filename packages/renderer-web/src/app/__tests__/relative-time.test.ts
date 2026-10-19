import { describe, expect, test } from "bun:test";
import { formatRelativeTime, relativeTickIntervalMs } from "../relative-time.ts";

const NOW = 1_700_000_000_000;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("formatRelativeTime", () => {
  test.each([
    [0, "now"],
    [-5 * SECOND, "5 seconds ago"],
    [-59 * SECOND, "59 seconds ago"],
    [-60 * SECOND, "1 minute ago"],
    [-5 * MINUTE, "5 minutes ago"],
    [-59 * MINUTE - 40 * SECOND, "1 hour ago"],
    [-3 * HOUR, "3 hours ago"],
    [-DAY, "yesterday"],
    [-3 * DAY, "3 days ago"],
  ])("past %p ms from now reads %p", (offsetMs, expected) => {
    expect(formatRelativeTime(NOW + offsetMs, NOW, "en")).toBe(expected);
  });

  test.each([
    [30 * SECOND, "in 30 seconds"],
    [2 * MINUTE, "in 2 minutes"],
    [2 * HOUR, "in 2 hours"],
    [DAY, "tomorrow"],
  ])("future %p ms from now reads %p (countdown)", (offsetMs, expected) => {
    expect(formatRelativeTime(NOW + offsetMs, NOW, "en")).toBe(expected);
  });

  test("uses the given locale", () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, "de")).toBe("vor 5 Minuten");
  });
});

describe("relativeTickIntervalMs", () => {
  test("ticks every second while the text shows seconds", () => {
    expect(relativeTickIntervalMs(0)).toBe(1000);
    expect(relativeTickIntervalMs(59 * SECOND)).toBe(1000);
  });

  test("ticks every 30 seconds once the text shows minutes or more", () => {
    expect(relativeTickIntervalMs(MINUTE)).toBe(30_000);
    expect(relativeTickIntervalMs(3 * DAY)).toBe(30_000);
  });
});
