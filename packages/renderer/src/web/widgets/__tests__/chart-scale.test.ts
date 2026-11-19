import { describe, expect, test } from "bun:test";
import { niceTicks } from "../chart-scale.ts";

describe("niceTicks", () => {
  test("rounds the range outward to a 1/2/5 step", () => {
    expect(niceTicks(0, 95, 5)).toEqual([0, 50, 100]);
  });

  test("covers a range that crosses zero", () => {
    expect(niceTicks(-30, 70, 6)).toEqual([-40, -20, 0, 20, 40, 60, 80]);
  });

  test("a flat range yields two ticks", () => {
    expect(niceTicks(0, 0, 5)).toEqual([0, 1]);
  });

  test("fractional steps are rounded to their decimals", () => {
    expect(niceTicks(0, 0.9, 4)).toEqual([0, 0.5, 1]);
  });
});
