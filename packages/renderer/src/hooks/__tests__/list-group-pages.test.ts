import { describe, expect, test } from "bun:test";
import {
  groupPageKey,
  groupPagePayload,
  type ListGroupPageResult,
  loadedGroupPages,
  withoutListPaging,
} from "../list-group-pages.ts";

const base = withoutListPaging({
  limit: 25,
  offset: 50,
  cursor: "c",
  totalCount: true,
  search: "rent",
  filter: { field: "archived", op: "eq", value: false },
  filters: [{ field: "amount", op: "gte", value: 1000 }],
});

describe("group page payloads", () => {
  test("the aggregate base keeps search and filters but drops paging", () => {
    expect(base).toEqual({
      search: "rent",
      filter: { field: "archived", op: "eq", value: false },
      filters: [{ field: "amount", op: "gte", value: 1000 }],
    });
  });

  test("a group page appends the group filter, including null for the empty group", () => {
    const payload = groupPagePayload({
      base,
      groupField: "status",
      groupValue: null,
      pageSize: 25,
      pageIndex: 0,
      paging: "offset",
      cursor: undefined,
    });
    expect(payload["filters"]).toEqual([
      { field: "amount", op: "gte", value: 1000 },
      { field: "status", op: "eq", value: null },
    ]);
    expect(payload["limit"]).toBe(25);
    expect(payload).not.toHaveProperty("offset");
  });

  test("offset paging steps by page size, cursor paging forwards the previous cursor", () => {
    const common = { base, groupField: "status", groupValue: "open", pageSize: 25, pageIndex: 2 };
    expect(groupPagePayload({ ...common, paging: "offset", cursor: undefined })["offset"]).toBe(50);
    const cursorPage = groupPagePayload({ ...common, paging: "cursor", cursor: "next" });
    expect(cursorPage["cursor"]).toBe("next");
    expect(cursorPage).not.toHaveProperty("offset");
  });
});

describe("loaded group pages", () => {
  const page = (id: string): ListGroupPageResult => ({
    rows: [{ id }],
    nextCursor: null,
    loading: false,
  });

  test("pages come back in order up to the first one still missing", () => {
    const results = new Map([
      [groupPageKey("open", 0), page("a")],
      [groupPageKey("open", 2), page("c")],
      [groupPageKey("done", 1), page("x")],
    ]);
    expect(loadedGroupPages(results, "open", 3).map((p) => p.rows[0]?.["id"])).toEqual(["a"]);
    expect(loadedGroupPages(results, "done", 2)).toEqual([]);
  });
});
