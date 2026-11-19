import { describe, expect, test } from "bun:test";
import { appendUnseenRows, mergeFreshFirstPage, rowIdSet } from "../infinite-rows.ts";

type Row = { readonly id: string; readonly v?: number };
const idOf = (row: Row): string => row.id;

describe("appendUnseenRows", () => {
  test("appends only rows with unknown ids", () => {
    const result = appendUnseenRows<Row>(
      [{ id: "a" }, { id: "b" }],
      [{ id: "b" }, { id: "c" }],
      idOf,
    );
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
      freshPageHasNextPage: false,
      rowIdOf: idOf,
    });
    expect(result).toEqual([{ id: "a", v: 2 }, { id: "c" }, { id: "d" }]);
  });

  test("puts a new row of the fresh page in front", () => {
    const result = mergeFreshFirstPage({
      loadedRows,
      previousFirstPageIds,
      freshFirstPage: [{ id: "n" }, { id: "a", v: 1 }, { id: "b" }],
      freshPageHasNextPage: true,
      rowIdOf: idOf,
    });
    expect(result.map(idOf)).toEqual(["n", "a", "b", "c", "d"]);
  });
});

describe("mergeFreshFirstPage with a fixed page size of 3 and page 2 loaded", () => {
  const loadedRows: readonly Row[] = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
  const previousFirstPageIds = rowIdSet<Row>(loadedRows.slice(0, 3), idOf);
  const merge = (freshIds: readonly string[], freshPageHasNextPage = true): unknown[] =>
    mergeFreshFirstPage<Row>({
      loadedRows,
      previousFirstPageIds,
      freshFirstPage: freshIds.map((id) => ({ id })),
      freshPageHasNextPage,
      rowIdOf: idOf,
    }).map(idOf);

  test("keeps the last row an insert pushed onto page 2", () => {
    expect(merge(["n", "a", "b"])).toEqual(["n", "a", "b", "c", "d", "e", "f"]);
  });

  test("keeps the row pushed down when a page 2 row is re-sorted to the top", () => {
    expect(merge(["e", "a", "b"])).toEqual(["e", "a", "b", "c", "d", "f"]);
  });

  test("drops a deleted first-page row whose slot a page 2 row filled", () => {
    expect(merge(["a", "b", "d"])).toEqual(["a", "b", "d", "e", "f"]);
    expect(merge(["a", "c", "d"])).toEqual(["a", "c", "d", "e", "f"]);
    expect(merge(["b", "c", "d"])).toEqual(["b", "c", "d", "e", "f"]);
  });

  test("drops a missing first-page row when the fresh page is the last page", () => {
    expect(merge(["n", "a", "b"], false)).toEqual(["n", "a", "b", "d", "e", "f"]);
  });
});
