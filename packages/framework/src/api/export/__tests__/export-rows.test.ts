import { describe, expect, test } from "bun:test";
import type { SessionUser } from "../../../engine/types/index.ts";
import { InternalError } from "../../../errors/index.ts";
import { TestUsers } from "../../../seeding/seed-users.ts";
import { isPlainObject } from "../../../utils/is-plain-object.ts";
import { readExportRows, sanitizeExportPayload } from "../export-rows.ts";
import type { ExportPlan } from "../export-screen.ts";

const user: SessionUser = TestUsers.admin;
const plan = (maxRows: number, screenFilter?: ExportPlan["screenFilter"]): ExportPlan => ({
  screenShortId: "s",
  queryType: "x:query:y:list",
  screenFilter,
  columns: [],
  maxRows,
});

type Call = Record<string, unknown>;

function fakeDispatcher(respond: (payload: Call, call: number) => unknown) {
  const calls: Call[] = [];
  return {
    calls,
    query: async (_type: string, payload: unknown) => {
      const call = isPlainObject(payload) ? payload : {};
      calls.push(call);
      return respond(call, calls.length - 1);
    },
  };
}

const rowsOf = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ id: `r${from + i}` }));

describe("sanitizeExportPayload", () => {
  test("drops client paging and aggregation, keeps search and facets, replaces filter", () => {
    const payload = sanitizeExportPayload(
      {
        limit: 1,
        offset: 2,
        cursor: "c",
        totalCount: true,
        aggregate: {},
        includeDeleted: true,
        filter: { field: "a", op: "eq", value: 1 },
        search: "q",
        filters: [],
      },
      { screenFilter: { field: "status", op: "eq", value: "open" } },
    );
    expect(payload).toEqual({
      search: "q",
      filters: [],
      filter: { field: "status", op: "eq", value: "open" },
    });
  });

  test("a screen without filter leaves none behind", () => {
    const payload = sanitizeExportPayload(
      { filter: { field: "a", op: "eq", value: 1 } },
      {
        screenFilter: undefined,
      },
    );
    expect(payload).toEqual({});
  });
});

describe("readExportRows", () => {
  test("follows nextCursor in pages of 200 and stops on a short page", async () => {
    const d = fakeDispatcher((_p, call) =>
      call === 0
        ? { rows: rowsOf(200), nextCursor: "c1" }
        : { rows: rowsOf(50, 200), nextCursor: null },
    );
    const result = await readExportRows(d, plan(1000), {}, user);
    expect(result).toMatchObject({ tooMany: false });
    expect(result.tooMany ? 0 : result.rows).toHaveLength(250);
    expect(d.calls.map((c) => [c["limit"], c["cursor"]])).toEqual([
      [200, undefined],
      [200, "c1"],
    ]);
  });

  test("pages by offset when the query returns no cursor", async () => {
    const d = fakeDispatcher((p) => ({
      rows: rowsOf(Math.min(200, 450 - Number(p["offset"] ?? 0)), Number(p["offset"] ?? 0)),
    }));
    const result = await readExportRows(d, plan(1000), {}, user);
    expect(result.tooMany ? 0 : result.rows).toHaveLength(450);
    expect(d.calls.map((c) => c["offset"])).toEqual([undefined, 200, 400]);
  });

  test("reports too many rows as soon as maxRows + 1 are read", async () => {
    const d = fakeDispatcher(() => ({ rows: rowsOf(200), nextCursor: "next" }));
    const result = await readExportRows(d, plan(250), {}, user);
    expect(result).toEqual({ tooMany: true });
    expect(d.calls.map((c) => c["limit"])).toEqual([200, 51]);
  });

  test("stops on a repeated cursor instead of looping", async () => {
    const d = fakeDispatcher(() => ({ rows: rowsOf(200), nextCursor: "same" }));
    const result = await readExportRows(d, plan(100000), {}, user);
    expect(result.tooMany).toBe(false);
    expect(d.calls).toHaveLength(2);
  });

  test("an empty first page yields no rows", async () => {
    const d = fakeDispatcher(() => ({ rows: [], nextCursor: null }));
    expect(await readExportRows(d, plan(10), {}, user)).toEqual({ tooMany: false, rows: [] });
  });

  test("a response without a rows envelope is an internal error", async () => {
    const d = fakeDispatcher(() => ({ items: [] }));
    await expect(readExportRows(d, plan(10), {}, user)).rejects.toBeInstanceOf(InternalError);
  });
});
