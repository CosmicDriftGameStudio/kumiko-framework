// fw#2165: buildListQueryPayload was extracted out of EntityListBody's
// queryPayload useMemo so ProjectionListBody could reuse it without
// duplicating the branch logic. This pins the extracted function against
// exactly what EntityListBody built before the extraction — the regression
// floor both list types now sit on.
import { describe, expect, test } from "bun:test";
import { buildListQueryPayload } from "../kumiko-screen";

const base = {
  limit: 50,
  search: "",
  sort: null,
  usePager: false,
  page: 1,
  useInfinite: false,
  cursor: undefined,
} as const;

describe("buildListQueryPayload", () => {
  test("bare state: only limit, no search/sort/pager/infinite keys", () => {
    expect(buildListQueryPayload(base)).toEqual({ limit: 50 });
  });

  test("empty search term is omitted, not sent as an empty string", () => {
    expect(buildListQueryPayload({ ...base, search: "" })).toEqual({ limit: 50 });
  });

  test("non-empty search lands in the payload", () => {
    expect(buildListQueryPayload({ ...base, search: "acme" })).toEqual({
      limit: 50,
      search: "acme",
    });
  });

  test("no sort: neither sort nor sortDirection appear", () => {
    expect(buildListQueryPayload({ ...base, sort: null })).toEqual({ limit: 50 });
  });

  test("sort carries both field and direction", () => {
    expect(buildListQueryPayload({ ...base, sort: { field: "createdAt", dir: "desc" } })).toEqual({
      limit: 50,
      sort: "createdAt",
      sortDirection: "desc",
    });
  });

  test("pager mode, page 1: totalCount is sent, offset is omitted (not offset: 0)", () => {
    expect(buildListQueryPayload({ ...base, usePager: true, page: 1 })).toEqual({
      limit: 50,
      totalCount: true,
    });
  });

  test("pager mode, page 3: offset is (page - 1) * limit", () => {
    expect(buildListQueryPayload({ ...base, usePager: true, page: 3 })).toEqual({
      limit: 50,
      offset: 100,
      totalCount: true,
    });
  });

  test("infinite mode without a cursor yet: no cursor key", () => {
    expect(buildListQueryPayload({ ...base, useInfinite: true, cursor: undefined })).toEqual({
      limit: 50,
    });
  });

  test("infinite mode with a cursor: cursor lands in the payload", () => {
    expect(buildListQueryPayload({ ...base, useInfinite: true, cursor: "row-42" })).toEqual({
      limit: 50,
      cursor: "row-42",
    });
  });

  test("pager wins over infinite when both flags are true (usePager gates first)", () => {
    expect(
      buildListQueryPayload({ ...base, usePager: true, useInfinite: true, cursor: "row-42" }),
    ).toEqual({ limit: 50, totalCount: true });
  });

  test("pagination=false (neither pager nor infinite): no pagination keys at all", () => {
    expect(
      buildListQueryPayload({ ...base, usePager: false, useInfinite: false, cursor: "row-42" }),
    ).toEqual({ limit: 50 });
  });

  test("full combination: search + sort + pager", () => {
    expect(
      buildListQueryPayload({
        limit: 25,
        search: "acme",
        sort: { field: "name", dir: "asc" },
        usePager: true,
        page: 2,
        useInfinite: false,
        cursor: undefined,
      }),
    ).toEqual({
      limit: 25,
      search: "acme",
      sort: "name",
      sortDirection: "asc",
      offset: 25,
      totalCount: true,
    });
  });
});
