import { describe, expect, test } from "bun:test";
import { toPostgresArrayLiteral } from "../postgres-array-literal";

describe("toPostgresArrayLiteral", () => {
  test("empty array", () => {
    expect(toPostgresArrayLiteral([])).toBe("{}");
  });

  test("quotes every element and joins with commas", () => {
    expect(toPostgresArrayLiteral(["a", "b,c"])).toBe('{"a","b,c"}');
  });

  test("escapes double quotes and backslashes", () => {
    expect(toPostgresArrayLiteral(['say "hi"', "back\\slash"])).toBe(
      '{"say \\"hi\\"","back\\\\slash"}',
    );
  });

  test("keeps braces inside quoted elements", () => {
    expect(toPostgresArrayLiteral(["{x}", "}{"])).toBe('{"{x}","}{"}');
  });

  test("null becomes unquoted NULL, the string NULL stays quoted", () => {
    expect(toPostgresArrayLiteral([null, "NULL"])).toBe('{NULL,"NULL"}');
  });

  test("unicode passes through", () => {
    expect(toPostgresArrayLiteral(["äöü", "日本", "😀"])).toBe('{"äöü","日本","😀"}');
  });

  test("numbers and bigint beyond safe integer range keep full precision", () => {
    expect(toPostgresArrayLiteral([1, 9007199254740993n])).toBe('{"1","9007199254740993"}');
  });
});
