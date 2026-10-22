import { describe, expect, test } from "bun:test";
import { isListAggregateResult, listAggregatePayloadSchema } from "../list-aggregate-types.ts";

describe("listAggregatePayloadSchema", () => {
  test("accepts groupBy with measures", () => {
    const parsed = listAggregatePayloadSchema.parse({
      groupBy: "status",
      measures: [{ field: "amount", kind: "sum" }],
    });
    expect(parsed.groupBy).toBe("status");
    expect(parsed.measures).toEqual([{ field: "amount", kind: "sum" }]);
  });

  test("accepts a payload without groupBy and defaults measures", () => {
    const parsed = listAggregatePayloadSchema.parse({});
    expect(parsed.groupBy).toBeUndefined();
    expect(parsed.measures).toEqual([]);
  });

  test("rejects an unknown measure kind", () => {
    const result = listAggregatePayloadSchema.safeParse({
      measures: [{ field: "amount", kind: "median" }],
    });
    expect(result.success).toBe(false);
  });

  test("rejects more than 20 measures", () => {
    const measures = Array.from({ length: 21 }, () => ({ field: "amount", kind: "sum" }));
    expect(listAggregatePayloadSchema.safeParse({ measures }).success).toBe(false);
  });
});

describe("isListAggregateResult", () => {
  test("recognises the groups shape and rejects row pages", () => {
    expect(isListAggregateResult({ groups: [] })).toBe(true);
    expect(isListAggregateResult({ rows: [], nextCursor: null })).toBe(false);
    expect(isListAggregateResult(null)).toBe(false);
  });

  test("does not treat a row with a groups field as an aggregate", () => {
    expect(isListAggregateResult({ id: "1", groups: ["a"] })).toBe(false);
  });
});
