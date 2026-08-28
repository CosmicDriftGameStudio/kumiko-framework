import { describe, expect, test } from "bun:test";
import { computeFraction, computeTone, computeUnclampedFraction } from "../usage-math";

describe("computeFraction", () => {
  test("used 3 of limit 5 -> 0.6", () => {
    expect(computeFraction(3, 5)).toBe(0.6);
  });

  test("limit 0 -> 0, never NaN/Infinity", () => {
    expect(computeFraction(5, 0)).toBe(0);
    expect(computeFraction(0, 0)).toBe(0);
  });

  test("negative limit -> 0", () => {
    expect(computeFraction(1, -5)).toBe(0);
  });

  test("used over limit clamps to 1", () => {
    expect(computeFraction(9, 5)).toBe(1);
  });

  test("used 0 of a positive limit -> 0", () => {
    expect(computeFraction(0, 5)).toBe(0);
  });
});

describe("computeUnclampedFraction", () => {
  test("used over limit -> ratio above 1, unlike computeFraction", () => {
    expect(computeUnclampedFraction(7, 5)).toBe(1.4);
    expect(computeFraction(7, 5)).toBe(1);
  });

  test("limit 0 -> 0, never NaN/Infinity", () => {
    expect(computeUnclampedFraction(5, 0)).toBe(0);
  });

  test("used 3 of limit 5 -> 0.6, same as the clamped case", () => {
    expect(computeUnclampedFraction(3, 5)).toBe(0.6);
  });
});

describe("computeTone", () => {
  test("below 0.8 -> default", () => {
    expect(computeTone(0)).toBe("default");
    expect(computeTone(0.79)).toBe("default");
  });

  test("0.8 up to (not including) 1 -> warn", () => {
    expect(computeTone(0.8)).toBe("warn");
    expect(computeTone(0.99)).toBe("warn");
  });

  test("5/5 (fraction 1) -> danger", () => {
    expect(computeTone(computeFraction(5, 5))).toBe("danger");
  });

  test("fraction >= 1 -> danger", () => {
    expect(computeTone(1)).toBe("danger");
  });
});
