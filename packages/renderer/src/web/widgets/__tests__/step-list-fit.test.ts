import { describe, expect, test } from "bun:test";
import { stepsThatFit } from "../step-list-fit.ts";

describe("stepsThatFit", () => {
  test("nothing folds while every row fits", () => {
    expect(
      stepsThatFit({
        rowHeights: [40, 40, 40],
        availableHeight: 120,
        moreRowHeight: 30,
        minimum: 1,
      }),
    ).toBeUndefined();
  });

  test("an overflowing list keeps as many rows as fit above the 'more' row", () => {
    expect(
      stepsThatFit({
        rowHeights: [40, 40, 40, 40],
        availableHeight: 120,
        moreRowHeight: 30,
        minimum: 1,
      }),
    ).toBe(2);
  });

  test("the minimum shows even when those rows alone overflow", () => {
    expect(
      stepsThatFit({
        rowHeights: [80, 80, 80, 80],
        availableHeight: 120,
        moreRowHeight: 30,
        minimum: 3,
      }),
    ).toBe(3);
  });

  test("a minimum covering every row folds nothing", () => {
    expect(
      stepsThatFit({ rowHeights: [80, 80], availableHeight: 100, moreRowHeight: 30, minimum: 2 }),
    ).toBeUndefined();
  });
});
