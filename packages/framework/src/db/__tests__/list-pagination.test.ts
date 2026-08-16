import { describe, expect, test } from "bun:test";
import { UnprocessableError } from "../../errors";
import { resolveListPagination } from "../event-store-executor-read";

describe("resolveListPagination — executor-level guard", () => {
  test("defaults: limit 50, offset 0", () => {
    expect(resolveListPagination({})).toEqual({ limit: 50, offset: 0 });
  });

  test("clamps limit to MAX_LIST_LIMIT (200)", () => {
    expect(resolveListPagination({ limit: 10_000 })).toEqual({ limit: 200, offset: 0 });
  });

  test("rejects a non-integer limit", () => {
    expect(() => resolveListPagination({ limit: "50; DROP TABLE x; --" })).toThrow(
      UnprocessableError,
    );
  });

  test("rejects a negative or fractional offset", () => {
    expect(() => resolveListPagination({ offset: -1 })).toThrow(UnprocessableError);
    expect(() => resolveListPagination({ offset: 1.5 })).toThrow(UnprocessableError);
  });

  test("passes through a valid limit + offset", () => {
    expect(resolveListPagination({ limit: 25, offset: 100 })).toEqual({ limit: 25, offset: 100 });
  });
});
