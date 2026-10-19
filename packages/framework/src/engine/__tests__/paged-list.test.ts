import { describe, expect, test } from "bun:test";
import { pagedListSchema, pageRows } from "../paged-list.ts";

type Row = {
  readonly id: string;
  readonly name: string | null;
  readonly score: number | null;
};

const SORTABLE = ["name", "score"] as const;

const rows: readonly Row[] = [
  { id: "r1", name: "Bravo", score: 2 },
  { id: "r2", name: "alpha", score: 2 },
  { id: "r3", name: null, score: null },
  { id: "r4", name: "Charlie", score: 5 },
  { id: "r5", name: "ALPHABET", score: 1 },
];

const options = { searchFields: ["name"] as const, defaultSort: "name" } as const;
const idsOf = (page: { rows: readonly Row[] }) => page.rows.map((row) => row.id);

describe("pageRows", () => {
  test("searches case-insensitively on the search fields", () => {
    expect(idsOf(pageRows(rows, { limit: 50, search: " ALPHA " }, options))).toEqual(["r2", "r5"]);
  });

  test("sorts by the default field with missing values last", () => {
    expect(idsOf(pageRows(rows, { limit: 50 }, options))).toEqual(["r2", "r5", "r1", "r4", "r3"]);
  });

  test("keeps missing values last in descending order too", () => {
    expect(idsOf(pageRows(rows, { limit: 50, sortDirection: "desc" }, options))).toEqual([
      "r4",
      "r1",
      "r5",
      "r2",
      "r3",
    ]);
  });

  test("breaks ties by id in both directions", () => {
    const asc = pageRows(rows, { limit: 50, sort: "score" }, options);
    expect(idsOf(asc)).toEqual(["r5", "r1", "r2", "r4", "r3"]);
    const desc = pageRows(rows, { limit: 50, sort: "score", sortDirection: "desc" }, options);
    expect(idsOf(desc)).toEqual(["r4", "r1", "r2", "r5", "r3"]);
  });

  test("applies offset and limit and never returns a cursor", () => {
    const page = pageRows(rows, { limit: 2, offset: 2 }, options);
    expect(idsOf(page)).toEqual(["r1", "r4"]);
    expect(page.nextCursor).toBeNull();
    expect(idsOf(pageRows(rows, { limit: 2, offset: 4 }, options))).toEqual(["r3"]);
    expect(idsOf(pageRows(rows, { limit: 2, offset: 10 }, options))).toEqual([]);
  });

  test("reports the matching total only when totalCount is set", () => {
    const withTotal = pageRows(rows, { limit: 1, search: "alpha", totalCount: true }, options);
    expect(withTotal.total).toBe(2);
    expect("total" in pageRows(rows, { limit: 1, search: "alpha" }, options)).toBe(false);
    expect("total" in pageRows(rows, { limit: 1, totalCount: false }, options)).toBe(false);
  });
});

describe("pagedListSchema", () => {
  const schema = pagedListSchema(SORTABLE);

  test("defaults the limit and accepts offset, sort and totalCount", () => {
    expect(schema.parse({})).toEqual({ limit: 50 });
    expect(
      schema.parse({
        limit: 10,
        offset: 20,
        sort: "score",
        sortDirection: "desc",
        totalCount: true,
      }),
    ).toEqual({ limit: 10, offset: 20, sort: "score", sortDirection: "desc", totalCount: true });
  });

  test("rejects unknown sort fields, a negative offset and an oversized limit", () => {
    expect(schema.safeParse({ sort: "other" }).success).toBe(false);
    expect(schema.safeParse({ offset: -1 }).success).toBe(false);
    expect(schema.safeParse({ limit: 100_000 }).success).toBe(false);
  });

  test("rejects a cursor instead of silently serving page one", () => {
    const result = schema.safeParse({ cursor: "MjA=" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(["cursor"]);
  });
});
