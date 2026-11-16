import { describe, expect, test } from "bun:test";
import { appendUnseenRows, mergeFreshFirstPage, rowIdSet } from "../infinite-rows.ts";

type Row = { readonly id: string; readonly v?: number };
const idOf = (row: Row): string => row.id;

describe("appendUnseenRows", () => {
  test("appends only rows with unknown ids", () => {
    const result = appendUnseenRows<Row>([{ id: "a" }, { id: "b" }], [{ id: "b" }, { id: "c" }], idOf);
    expect(result.map(idOf)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeFreshFirstPage", () => {
  const loadedRows: readonly Row[] = [{ id: "a", v: 1 }, { id: "b" }, { id: "c" }, { id: "d" }];
  const previousFirstPageIds = rowIdSet<Row>([{ id: "a" }, { id: "b" }], idOf);

  test("updates changed rows, drops deleted first-page rows and keeps later pages", () => {
    const result = mergeFreshFirstPage({
      loadedRows,
      previousFirstPageIds,
      freshFirstPage: [{ id: "a", v: 2 }],
      rowIdOf: idOf,
    });
    expect(result).toEqual([{ id: "a", v: 2 }, { id: "c" }, { id: "d" }]);
  });

  test("puts a new row of the fresh page in front", () => {
    const result = mergeFreshFirstPage({
      loadedRows,
      previousFirstPageIds,
      freshFirstPage: [{ id: "n" }, { id: "a", v: 1 }, { id: "b" }],
      rowIdOf: idOf,
    });
    expect(result.map(idOf)).toEqual(["n", "a", "b", "c", "d"]);
  });
});
