import { describe, expect, test } from "bun:test";
import { tagOpenerBudgetCutoff } from "../html-tag-budget.ts";

describe("tagOpenerBudgetCutoff", () => {
  test("returns -1 when there is no '<'", () => {
    expect(tagOpenerBudgetCutoff("plain text", 0)).toBe(-1);
  });

  test("returns -1 exactly at the budget", () => {
    expect(tagOpenerBudgetCutoff("<a><b>", 2)).toBe(-1);
  });

  test("returns the index of the first '<' past the budget", () => {
    expect(tagOpenerBudgetCutoff("<a><b><c>", 2)).toBe(6);
  });

  test("counts every '<', also without a tag", () => {
    expect(tagOpenerBudgetCutoff("x < y", 0)).toBe(2);
  });
});
