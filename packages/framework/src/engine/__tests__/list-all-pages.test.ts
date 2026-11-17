import { describe, expect, test } from "bun:test";
import { InternalError } from "../../errors/index.ts";
import { MAX_LIST_LIMIT } from "../entity-handlers.ts";
import {
  LIST_ALL_PAGES_DEFAULT_MAX_PAGES,
  type ListPage,
  type ListPageRequest,
  listAllPages,
  toListPage,
} from "../list-all-pages.ts";

function pageSource<Row>(pages: readonly ListPage<Row>[]) {
  const requests: ListPageRequest[] = [];
  const fetchPage = async (request: ListPageRequest): Promise<ListPage<Row>> => {
    requests.push(request);
    const page = pages[Math.min(requests.length - 1, pages.length - 1)];
    if (page === undefined) throw new Error("pageSource needs at least one page");
    return page;
  };
  return { requests, fetchPage };
}

describe("listAllPages", () => {
  test("throws InternalError when the list still has a cursor after maxPages pages", async () => {
    const source = pageSource<number>([
      { rows: [1], nextCursor: "c1" },
      { rows: [2], nextCursor: "c2" },
    ]);
    const result = listAllPages(source.fetchPage, { maxPages: 2 });
    await expect(result).rejects.toThrow(InternalError);
    await expect(result).rejects.toThrow(/more than 2 pages/);
    expect(source.requests).toHaveLength(2);
  });

  test("reads exactly maxPages pages when the last one ends the list", async () => {
    const source = pageSource<number>([
      { rows: [1], nextCursor: "c1" },
      { rows: [2], nextCursor: null },
    ]);
    expect(await listAllPages(source.fetchPage, { maxPages: 2 })).toEqual([1, 2]);
  });

  test("an invalid maxPages throws before the first fetch", async () => {
    const source = pageSource<number>([{ rows: [1], nextCursor: null }]);
    await expect(listAllPages(source.fetchPage, { maxPages: 0 })).rejects.toThrow(InternalError);
    expect(source.requests).toHaveLength(0);
  });

  test("the default cap is LIST_ALL_PAGES_DEFAULT_MAX_PAGES", async () => {
    const requests: ListPageRequest[] = [];
    const fetchPage = async (request: ListPageRequest): Promise<ListPage<number>> => {
      requests.push(request);
      return { rows: [requests.length], nextCursor: `c${requests.length}` };
    };
    await expect(listAllPages(fetchPage)).rejects.toThrow(InternalError);
    expect(requests).toHaveLength(LIST_ALL_PAGES_DEFAULT_MAX_PAGES);
  });

  test("follows nextCursor until it is null and asks every page for MAX_LIST_LIMIT rows", async () => {
    const source = pageSource<number>([
      { rows: [1, 2], nextCursor: "c1" },
      { rows: [3], nextCursor: "c2" },
      { rows: [4], nextCursor: null },
    ]);
    expect(await listAllPages(source.fetchPage)).toEqual([1, 2, 3, 4]);
    expect(source.requests).toEqual([
      { limit: MAX_LIST_LIMIT },
      { limit: MAX_LIST_LIMIT, cursor: "c1" },
      { limit: MAX_LIST_LIMIT, cursor: "c2" },
    ]);
    expect("cursor" in (source.requests[0] ?? {})).toBe(false);
  });

  test("treats an empty or missing nextCursor as the last page", async () => {
    const empty = pageSource<number>([{ rows: [1], nextCursor: "" }]);
    expect(await listAllPages(empty.fetchPage)).toEqual([1]);
    expect(empty.requests).toHaveLength(1);
    const missing = pageSource<number>([{ rows: [2] }]);
    expect(await listAllPages(missing.fetchPage)).toEqual([2]);
    expect(missing.requests).toHaveLength(1);
  });

  test("rejects a list handler that repeats a cursor", async () => {
    const source = pageSource<number>([{ rows: [1], nextCursor: "same" }]);
    await expect(listAllPages(source.fetchPage)).rejects.toBeInstanceOf(InternalError);
    expect(source.requests).toHaveLength(2);
  });
});

describe("toListPage", () => {
  test("keeps object rows and maps an empty cursor to null", () => {
    expect(toListPage({ rows: [{ id: "a" }], nextCursor: "" }, "x:list")).toEqual({
      rows: [{ id: "a" }],
      nextCursor: null,
    });
    expect(toListPage({ rows: [{ id: "a" }], nextCursor: "n1" }, "x:list").nextCursor).toBe("n1");
  });

  test("throws for a response without rows or with a non-object row", () => {
    expect(() => toListPage({}, "x:list")).toThrow(InternalError);
    expect(() => toListPage({ rows: [1] }, "x:list")).toThrow(InternalError);
    expect(() => toListPage(null, "x:list")).toThrow(InternalError);
  });
});
