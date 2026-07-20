import { describe, expect, test } from "bun:test";
import { sortByAccessor } from "../sort-by-accessor";

type Row = { readonly name: string; readonly count: number };

const rows: readonly Row[] = [
  { name: "b", count: 2 },
  { name: "a", count: 3 },
  { name: "c", count: 1 },
];

const accessors = {
  name: (r: Row) => r.name,
  count: (r: Row) => r.count,
};

describe("sortByAccessor", () => {
  test("sort === null returns rows unchanged (same reference)", () => {
    expect(sortByAccessor(rows, null, accessors)).toBe(rows);
  });

  test("an unknown field returns rows unchanged (same reference)", () => {
    expect(sortByAccessor(rows, { field: "nope", dir: "asc" }, accessors)).toBe(rows);
  });

  test("sorts ascending by the given accessor", () => {
    const sorted = sortByAccessor(rows, { field: "name", dir: "asc" }, accessors);
    expect(sorted.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  test("sorts descending by the given accessor", () => {
    const sorted = sortByAccessor(rows, { field: "count", dir: "desc" }, accessors);
    expect(sorted.map((r) => r.count)).toEqual([3, 2, 1]);
  });

  test("does not mutate the input array", () => {
    const original = [...rows];
    sortByAccessor(rows, { field: "name", dir: "asc" }, accessors);
    expect(rows).toEqual(original);
  });
});
