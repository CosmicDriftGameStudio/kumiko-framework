import { describe, expect, test } from "bun:test";
import type { FieldIssue } from "../../dispatcher";
import {
  computeDerivedCellValue,
  groupEmbeddedListIssues,
  sumEmbeddedListColumn,
} from "../embedded-list";

function issue(path: string): FieldIssue {
  return { path, code: "custom", i18nKey: "errors.validation.custom" };
}

describe("computeDerivedCellValue", () => {
  test("multiply with two values", () => {
    expect(computeDerivedCellValue("multiply", [3, 4])).toBe(12);
  });

  test("multiply with three values", () => {
    expect(computeDerivedCellValue("multiply", [2, 3, 5])).toBe(30);
  });

  test("sum adds all values", () => {
    expect(computeDerivedCellValue("sum", [1, 2, 3])).toBe(6);
  });

  test("subtract subtracts every value after the first", () => {
    expect(computeDerivedCellValue("subtract", [10, 3, 2])).toBe(5);
  });

  test("multiply returns undefined when a source is missing", () => {
    expect(computeDerivedCellValue("multiply", [3, undefined])).toBeUndefined();
  });

  test("sum treats a missing source as 0", () => {
    expect(computeDerivedCellValue("sum", [1, undefined, 2])).toBe(3);
  });

  test("subtract treats a missing source as 0", () => {
    expect(computeDerivedCellValue("subtract", [10, undefined])).toBe(10);
  });
});

describe("sumEmbeddedListColumn", () => {
  test("sums a numeric column across rows", () => {
    const rows = [{ amount: 100 }, { amount: 250 }, { amount: 50 }];
    expect(sumEmbeddedListColumn(rows, "amount")).toBe(400);
  });

  test("treats a row missing the field as 0", () => {
    const rows = [{ amount: 100 }, { other: 1 }, { amount: 50 }];
    expect(sumEmbeddedListColumn(rows, "amount")).toBe(150);
  });

  test("returns 0 for an empty rows array", () => {
    expect(sumEmbeddedListColumn([], "amount")).toBe(0);
  });
});

describe("groupEmbeddedListIssues", () => {
  test("buckets list/row/cell issues, ignoring unrelated and too-deep keys", () => {
    const allIssues: Record<string, readonly FieldIssue[]> = {
      lines: [issue("lines")],
      "lines.0": [issue("lines.0")],
      "lines.0.amount": [issue("lines.0.amount")],
      "lines.1.qty": [issue("lines.1.qty")],
      title: [issue("title")],
      "lines.0.amount.nested": [issue("lines.0.amount.nested")],
    };

    const result = groupEmbeddedListIssues(allIssues, "lines");

    expect(result.listIssues).toEqual([issue("lines")]);
    expect(result.rowIssues).toEqual({ 0: [issue("lines.0")] });
    expect(result.cellIssues).toEqual({
      "0.amount": [issue("lines.0.amount")],
      "1.qty": [issue("lines.1.qty")],
    });
    // Unrelated top-level key and the too-deep key must not leak anywhere.
    expect(Object.values(result.cellIssues).flat()).not.toContainEqual(issue("title"));
    expect(Object.values(result.cellIssues).flat()).not.toContainEqual(
      issue("lines.0.amount.nested"),
    );
  });
});
