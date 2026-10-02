import { describe, expect, test } from "bun:test";
import { sortByAccessor } from "../sort-by-accessor.js";

type Row = { readonly name: string; readonly count: number };

function makeRows(): readonly Row[] {
  return [
    { name: "b", count: 2 },
    { name: "a", count: 3 },
    { name: "c", count: 1 },
  ];
}

const accessors = {
  name: (r: Row) => r.name,
  count: (r: Row) => r.count,
};

describe("sortByAccessor", () => {
  test("sort === null returns rows unchanged (same reference)", () => {
    const rows = makeRows();
    expect(sortByAccessor(rows, null, accessors)).toBe(rows);
  });

  test("an unknown field returns rows unchanged (same reference)", () => {
    const rows = makeRows();
    expect(sortByAccessor(rows, { field: "nope", dir: "asc" }, accessors)).toBe(rows);
  });

  test("sorts ascending by the given accessor", () => {
    const rows = makeRows();
    const sorted = sortByAccessor(rows, { field: "name", dir: "asc" }, accessors);
    expect(sorted.map((r) => r.name)).toEqual(["a", "b", "c"]);
  });

  test("sorts descending by the given accessor", () => {
    const rows = makeRows();
    const sorted = sortByAccessor(rows, { field: "count", dir: "desc" }, accessors);
    expect(sorted.map((r) => r.count)).toEqual([3, 2, 1]);
  });

  test("does not mutate the input array", () => {
    const rows = makeRows();
    const original = [...rows];
    sortByAccessor(rows, { field: "name", dir: "asc" }, accessors);
    expect(rows).toEqual(original);
  });

  test("numeric strings order by value, not lexicographically", () => {
    const rows = [{ v: "1000" }, { v: "200" }, { v: "30" }];
    const sorted = sortByAccessor(rows, { field: "v", dir: "asc" }, { v: (r) => r.v });
    expect(sorted.map((r) => r.v)).toEqual(["30", "200", "1000"]);
  });

  test("null values sort last in both directions", () => {
    const rows: { v: number | null }[] = [{ v: null }, { v: 2 }, { v: 1 }];
    const accessors = { v: (r: { v: number | null }) => r.v };
    const asc = sortByAccessor(rows, { field: "v", dir: "asc" }, accessors);
    const desc = sortByAccessor(rows, { field: "v", dir: "desc" }, accessors);
    expect(asc.map((r) => r.v)).toEqual([1, 2, null]);
    expect(desc.map((r) => r.v)).toEqual([2, 1, null]);
  });

  test("strings compare locale-aware, so umlauts do not land after Z", () => {
    const rows = [{ v: "Zebra" }, { v: "Ärger" }, { v: "Apfel" }];
    const sorted = sortByAccessor(rows, { field: "v", dir: "asc" }, { v: (r) => r.v }, "de");
    expect(sorted.map((r) => r.v)).toEqual(["Apfel", "Ärger", "Zebra"]);
  });
});
