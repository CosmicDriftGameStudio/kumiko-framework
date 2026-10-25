// Direct coverage for the executor.list extension:
// offset, totalCount, and the "cursor wins over offset" behavior.
// Before this suite, these three branches were covered only indirectly
// through items-create.integration in the Showcase, which was insufficient
// for framework code used by every app.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { unsafeCreateEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { asRawClient } from "../../db/query.ts";
import {
  createDateField,
  createEntity,
  createNumberField,
  createTextField,
  SYSTEM_TENANT_ID,
} from "../../engine/index.ts";
import { UnprocessableError } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { encodeCursor } from "../cursor.ts";
import { createEventStoreExecutor } from "../event-store-executor.ts";
import { buildEntityTable } from "../table-builder.ts";
import { createTenantDb, type TenantDb } from "../tenant-db.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

const entity = createEntity({
  table: "read_pager_items",
  fields: {
    title: createTextField({
      required: true,
      sortable: true,
      personal: false,
      reason: "test_fixture",
    }),
    rank: createNumberField({ sortable: true }),
    dueDate: createDateField({ sortable: true }),
  },
});
const table = buildEntityTable("pagerItem", entity);

let testDb: BunTestDb;
let tdb: TenantDb;
const admin = TestUsers.admin;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  await unsafeCreateEntityTable(testDb.db, entity, "pagerItem");
  tdb = createTenantDb({ db: testDb.db, tenantId: admin.tenantId });
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(
    `TRUNCATE kumiko_events, read_pager_items RESTART IDENTITY CASCADE`,
  );
});

describe("event-store-executor.list — offset + totalCount (Tier 2.6d)", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  async function seed(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: i }, admin, tdb);
    }
  }

  test("without totalCount: response has NO total field (avoids extra COUNT)", async () => {
    await seed(5);
    const res = await exec.list({ limit: 50 }, admin, tdb);
    expect(res.rows).toHaveLength(5);
    expect("total" in res).toBe(false);
  });

  test("with totalCount=true: response has total = N", async () => {
    await seed(7);
    const res = await exec.list({ limit: 50, totalCount: true }, admin, tdb);
    expect(res.rows).toHaveLength(7);
    expect(res.total).toBe(7);
  });

  test("offset paginiert deterministisch (sort=rank asc + offset=2 → rows 3-5)", async () => {
    await seed(10);
    const res = await exec.list(
      { limit: 3, offset: 2, sort: "rank", sortDirection: "asc", totalCount: true },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([2, 3, 4]);
    expect(res.total).toBe(10);
  });

  test("offset >= total: empty rows, total remains correct", async () => {
    await seed(3);
    const res = await exec.list(
      { limit: 10, offset: 100, sort: "rank", sortDirection: "asc", totalCount: true },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(3);
  });

  test("cursor wins over offset (combination is a caller bug, defensive)", async () => {
    // If the caller accidentally sets BOTH—for example, a migration script
    // that mixes cursor pagination with page numbers—cursor must win because
    // it is database-stable. The offset is ignored.
    await seed(10);
    const first = await exec.list({ limit: 3, sort: "rank", sortDirection: "asc" }, admin, tdb);
    expect(first.rows.map((r) => r["rank"])).toEqual([0, 1, 2]);
    const cursor = first.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;
    // cursor + offset:50—the cursor should win, not the offset.
    // Note: cursor pagination here is NOT stable from row 3 to row 4 because
    // although the UUIDs are UUIDv7, the sub-sort is not guaranteed to
    // correlate with `rank` when they are generated within the same
    // millisecond. We only verify that "the cursor is used" means no
    // offset:50 skip to row 50 (which does not exist).
    const next = await exec.list(
      { limit: 3, cursor, offset: 50, sort: "rank", sortDirection: "asc" },
      admin,
      tdb,
    );
    // Without the cursor-wins branch, offset=50 would produce an empty result.
    // With cursor-wins, the gt(id, cursor) filter runs and returns
    // rows after the cursor, so at least one entry is returned.
    expect(next.rows.length).toBeGreaterThan(0);
  });

  test("totalCount on empty result: total=0, rows=[]", async () => {
    const res = await exec.list({ limit: 50, totalCount: true }, admin, tdb);
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});

describe("event-store-executor.list — stable order", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  test("offset paging with identical sort value: no row on both pages, union = all rows", async () => {
    // All rows share the same rank value. Postgres picks a Top-N heapsort
    // for LIMIT queries, which is not stable across ties — and different
    // offsets sort differently-sized heaps (LIMIT 3 OFFSET 0 sorts the
    // top 3, LIMIT 3 OFFSET 3 sorts the top 6), so without an id
    // tie-breaker the same row can surface on multiple pages while
    // another is skipped entirely. Needs enough rows + small enough
    // pages to make the heap sizes diverge; 10 rows / page 5 (the
    // previous setup) was too forgiving and stayed green without the fix.
    const total = 25;
    const pageSize = 3;
    for (let i = 0; i < total; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: 1 }, admin, tdb);
    }
    const page1 = await exec.list(
      { limit: pageSize, offset: 0, sort: "rank", sortDirection: "asc" },
      admin,
      tdb,
    );
    const page2 = await exec.list(
      { limit: pageSize, offset: pageSize, sort: "rank", sortDirection: "asc" },
      admin,
      tdb,
    );
    const ids1 = page1.rows.map((r) => r["id"]);
    const ids2 = page2.rows.map((r) => r["id"]);
    expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);

    const allIds = new Set<unknown>();
    for (let offset = 0; offset < total; offset += pageSize) {
      const page = await exec.list(
        { limit: pageSize, offset, sort: "rank", sortDirection: "asc" },
        admin,
        tdb,
      );
      for (const id of page.rows.map((r) => r["id"])) allIds.add(id);
    }
    expect(allIds.size).toBe(total);
  });

  test("cursor paging without sort: each row exactly once", async () => {
    // Plain sequential inserts keep heap physical order == uuidv7 id order,
    // so a Seq Scan without ORDER BY happens to come out sorted anyway and
    // the missing-ORDER-BY bug stays invisible. Delete half the rows and
    // VACUUM to free their heap space, then insert more rows so their
    // (higher) uuidv7 ids get placed into the reused (earlier) pages —
    // now physical scan order diverges from id order.
    const client = asRawClient(testDb.db);
    for (let i = 0; i < 100; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: i }, admin, tdb);
    }
    await client.unsafe(`DELETE FROM read_pager_items WHERE rank::int % 2 = 1`);
    await client.unsafe(`VACUUM read_pager_items`);
    for (let i = 100; i < 150; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: i }, admin, tdb);
    }
    const countRow = await client.unsafe(`SELECT count(*)::int AS c FROM read_pager_items`);
    const total = (countRow as unknown as Array<{ c: number }>)[0]?.c ?? 0;

    const seenIds: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < total + 5; page++) {
      const res = await exec.list({ limit: 3, cursor }, admin, tdb);
      seenIds.push(...res.rows.map((r) => r["id"] as string));
      if (res.nextCursor === null) break;
      cursor = res.nextCursor;
    }
    expect(seenIds).toHaveLength(total);
    expect(new Set(seenIds).size).toBe(total);
  });
});

describe("event-store-executor.list — filter (Tier 2.7c)", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  async function seed(n: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      await exec.create({ title: `item-${String(i).padStart(3, "0")}`, rank: i }, admin, tdb);
    }
  }

  test("filter eq: only the rank=5 row", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "eq", value: 5 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([5]);
  });

  test("filter ne: all except rank=2", async () => {
    await seed(5);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "ne", value: 2 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([0, 1, 3, 4]);
  });

  test("filter lt: rank < 3 → 0,1,2", async () => {
    await seed(6);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "lt", value: 3 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([0, 1, 2]);
  });

  test("filter gt: rank > 7 → 8,9", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "gt", value: 7 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([8, 9]);
  });

  test("filter lte: rank <= 3 → 0,1,2,3 (boundary included)", async () => {
    await seed(6);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "lte", value: 3 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([0, 1, 2, 3]);
  });

  test("filter gte: rank >= 7 → 7,8,9 (boundary included)", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "gte", value: 7 },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([7, 8, 9]);
  });

  test("filter lte on dueDate: boundary date included", async () => {
    await exec.create({ title: "d-1", dueDate: "2026-01-10" }, admin, tdb);
    await exec.create({ title: "d-2", dueDate: "2026-02-10" }, admin, tdb);
    await exec.create({ title: "d-3", dueDate: "2026-03-10" }, admin, tdb);
    const res = await exec.list(
      {
        limit: 50,
        sort: "dueDate",
        sortDirection: "asc",
        filter: { field: "dueDate", op: "lte", value: "2026-02-10" },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["title"])).toEqual(["d-1", "d-2"]);
  });

  test("filters[] gte+lte AND, combined with offset paging: second page is correct", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 2,
        offset: 2,
        sort: "rank",
        sortDirection: "asc",
        totalCount: true,
        filters: [
          { field: "rank", op: "gte", value: 2 },
          { field: "rank", op: "lte", value: 7 },
        ],
      },
      admin,
      tdb,
    );
    // range gte:2/lte:7 → [2,3,4,5,6,7] (6 rows), page size 2 offset 2 → [4,5]
    expect(res.rows.map((r) => r["rank"])).toEqual([4, 5]);
    expect(res.total).toBe(6);
  });

  test("filter in: rank in [1,3,5]", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "in", value: [1, 3, 5] },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([1, 3, 5]);
  });

  test("filter in with empty array: empty result (no match-all trap)", async () => {
    await seed(5);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "in", value: [] },
      },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(0);
  });

  test("filter ne with value null: matches rows with the field set", async () => {
    // rank is optional — before the fix, `ne` compiled to `rank <> NULL`,
    // which is never true in SQL and returned 0 rows.
    await seed(3);
    await exec.create({ title: "no-rank" }, admin, tdb);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "ne", value: null },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([0, 1, 2]);
  });

  test("filter eq with value null: matches rows with the field unset", async () => {
    await seed(3);
    await exec.create({ title: "no-rank" }, admin, tdb);
    const res = await exec.list(
      {
        limit: 50,
        filter: { field: "rank", op: "eq", value: null },
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["title"])).toEqual(["no-rank"]);
  });

  test("filter unknown-field: silent skip — no crash, all rows returned", async () => {
    // The boot validator normally prevents this; runtime defense handles a
    // test or caller sending a bogus field directly to the executor.
    // Returning all rows is preferable to entering a crash loop.
    await seed(3);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "doesNotExist", op: "eq", value: 1 },
      },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(3);
  });

  test("filter + totalCount: COUNT respektiert filter", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        totalCount: true,
        filter: { field: "rank", op: "lt", value: 4 },
      },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(4);
    expect(res.total).toBe(4);
  });

  test("filters[] AND: two dynamic filters are combined with AND", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filters: [
          { field: "rank", op: "gt", value: 2 },
          { field: "rank", op: "lt", value: 6 },
        ],
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([3, 4, 5]);
  });

  test("filters[] in: Faceted-Multi-Select rank in [2,4,8]", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filters: [{ field: "rank", op: "in", value: [2, 4, 8] }],
      },
      admin,
      tdb,
    );
    expect(res.rows.map((r) => r["rank"])).toEqual([2, 4, 8]);
  });

  test("combine static filter + dynamic filters[] with AND", async () => {
    await seed(10);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filter: { field: "rank", op: "gt", value: 2 },
        filters: [{ field: "rank", op: "in", value: [1, 3, 5, 9] }],
      },
      admin,
      tdb,
    );
    // gt:2 AND in[1,3,5,9] → 3,5,9 (1 is excluded by gt:2)
    expect(res.rows.map((r) => r["rank"])).toEqual([3, 5, 9]);
  });

  test("filters[] with empty in-array: empty result (no match-all)", async () => {
    await seed(5);
    const res = await exec.list(
      {
        limit: 50,
        sort: "rank",
        sortDirection: "asc",
        filters: [{ field: "rank", op: "in", value: [] }],
      },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(0);
  });
});

describe("event-store-executor.list — runtime SearchAdapter", () => {
  // Verifies that the executor accepts a searchAdapter from runtimeOptions
  // when none was supplied through options.searchAdapter at build time.
  // defaultEntityQueryHandler uses this path because the executor has no
  // context adapter available at definition time.
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  test("without searchAdapter: search parameter throws instead of silently doing nothing", async () => {
    for (let i = 0; i < 3; i++) {
      await exec.create({ title: `item-${i}`, rank: i }, admin, tdb);
    }
    const call = exec.list({ limit: 50, search: "irgendwas" }, admin, tdb);
    await expect(call).rejects.toThrow(UnprocessableError);
    await expect(call.catch((e: unknown) => e)).resolves.toMatchObject({
      code: "unprocessable",
      httpStatus: 422,
      details: {
        reason: "search_adapter_not_wired",
        entity: "pagerItem",
        hint: expect.stringContaining("SearchAdapter"),
      },
    });
  });

  test("with runtimeOptions.searchAdapter: search filters by returned IDs", async () => {
    for (let i = 0; i < 3; i++) {
      await exec.create({ title: `item-${i}`, rank: i }, admin, tdb);
    }
    const allRows = await exec.list({ limit: 50 }, admin, tdb);
    const matchedId = allRows.rows[1]?.["id"] as string;
    expect(matchedId).toBeDefined();

    // Mock adapter: returns exactly one ID, so only that row is passed through.
    const mockAdapter = {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async () => [{ entityType: "pagerItem", entityId: matchedId }],
      reset: async () => {},
    } as never;

    const res = await exec.list({ limit: 50, search: "x" }, admin, tdb, {
      searchAdapter: mockAdapter,
    });
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]?.["id"]).toBe(matchedId);
  });

  // Mirrors Meilisearch: a search without an explicit limit returns only 50 hits, and no limit
  // exceeds maxTotalHits.
  function limitHonoringAdapter(hits: readonly string[], maxTotalHits = Number.POSITIVE_INFINITY) {
    return {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async (_tenantId: string, _query: string, options?: { limit?: number }) =>
        hits
          .slice(0, Math.min(options?.limit ?? 50, maxTotalHits))
          .map((entityId) => ({ entityType: "pagerItem", entityId })),
      reset: async () => {},
    } as never;
  }

  test("search with more than 50 hits keeps every hit, not just the adapter's default page", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 60; i++) {
      const created = await exec.create({ title: `many-${i}`, rank: i }, admin, tdb);
      if (!created.isSuccess) throw new Error("create failed");
      ids.push(String(created.data["id"]));
    }

    const res = await exec.list({ limit: 200, search: "many" }, admin, tdb, {
      searchAdapter: limitHonoringAdapter(ids),
    });
    expect(res.rows).toHaveLength(60);
  });

  test("search that reaches the candidate cap is flagged searchTruncated, below it is not", async () => {
    const created = await exec.create({ title: "capped", rank: 1 }, admin, tdb);
    if (!created.isSuccess) throw new Error("create failed");
    const realId = String(created.data["id"]);
    // Meilisearch caps a response at maxTotalHits (1000) however high the limit is asked.
    const capped = Array.from({ length: 999 }, () => crypto.randomUUID());
    const atCap = await exec.list({ limit: 50, search: "everything" }, admin, tdb, {
      searchAdapter: limitHonoringAdapter([...capped, realId], 1000),
    });
    expect(atCap.searchTruncated).toBe(true);
    expect(atCap.rows.map((r) => r["id"])).toEqual([realId]);

    const belowCap = await exec.list({ limit: 50, search: "everything" }, admin, tdb, {
      searchAdapter: limitHonoringAdapter([...capped.slice(0, 998), realId], 1000),
    });
    expect(belowCap.searchTruncated).toBeUndefined();
  });

  test("with search without a match (adapter returns []): empty rows + no DB query", async () => {
    for (let i = 0; i < 3; i++) {
      await exec.create({ title: `item-${i}`, rank: i }, admin, tdb);
    }
    const mockAdapter = {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async () => [],
      reset: async () => {},
    } as never;
    const res = await exec.list({ limit: 50, search: "no-match" }, admin, tdb, {
      searchAdapter: mockAdapter,
    });
    expect(res.rows).toHaveLength(0);
  });

  test("system-mode list: search still uses session tenantId (streamTenantFor)", async () => {
    // Non-systemStream entities are indexed under event.tenantId (= session),
    // even when listed via r.systemScope() — db.mode must not redirect search.
    const systemTdb = createTenantDb({
      db: testDb.db,
      tenantId: admin.tenantId,
      mode: "system",
      reason: "test lists rows across tenants through the executor",
    });
    let searchedTenant: string | undefined;
    const mockAdapter = {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async (tenantId: string) => {
        searchedTenant = tenantId;
        return [];
      },
      reset: async () => {},
    } as never;
    await exec.list({ limit: 50, search: "x" }, admin, systemTdb, {
      searchAdapter: mockAdapter,
    });
    expect(searchedTenant).toBe(admin.tenantId);
  });

  test("tenant-mode list: search still uses session tenantId", async () => {
    let searchedTenant: string | undefined;
    const mockAdapter = {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async (tenantId: string) => {
        searchedTenant = tenantId;
        return [];
      },
      reset: async () => {},
    } as never;
    await exec.list({ limit: 50, search: "x" }, admin, tdb, {
      searchAdapter: mockAdapter,
    });
    expect(searchedTenant).toBe(admin.tenantId);
  });

  test("tenant-mode list: systemStream entity searches SYSTEM_TENANT_ID", async () => {
    const sysEntity = createEntity({
      table: "read_pager_sys",
      systemStream: true,
      fields: {
        title: createTextField({ required: true, personal: false, reason: "test_fixture" }),
      },
    });
    const sysTable = buildEntityTable("pagerSys", sysEntity);
    await unsafeCreateEntityTable(testDb.db, sysEntity, "pagerSys");
    const sysExec = createEventStoreExecutor(sysTable, sysEntity, { entityName: "pagerSys" });
    let searchedTenant: string | undefined;
    const mockAdapter = {
      configure: async () => {},
      index: async () => {},
      indexBatch: async () => {},
      remove: async () => {},
      search: async (tenantId: string) => {
        searchedTenant = tenantId;
        return [];
      },
      reset: async () => {},
    } as never;
    await sysExec.list({ limit: 50, search: "x" }, admin, tdb, {
      searchAdapter: mockAdapter,
    });
    expect(searchedTenant).toBe(SYSTEM_TENANT_ID);
  });
});

describe("event-store-executor.list — keyset cursor with custom sort", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  async function collectPages(
    sort: string,
    direction: "asc" | "desc",
    pageSize: number,
  ): Promise<{ ids: string[]; iterations: number }> {
    const ids: string[] = [];
    let cursor: string | undefined;
    let iterations = 0;
    while (iterations < 10) {
      iterations++;
      const res = await exec.list(
        { limit: pageSize, cursor, sort, sortDirection: direction },
        admin,
        tdb,
      );
      ids.push(...res.rows.map((r) => r["id"] as string));
      if (res.nextCursor === null) break;
      cursor = res.nextCursor;
    }
    return { ids, iterations };
  }

  test("Page 2 no longer duplicates the last row of page 1 or skips the oldest", async () => {
    await exec.create({ title: "re-1001", dueDate: "2026-01-15" }, admin, tdb);
    await exec.create({ title: "re-1002", dueDate: "2026-02-15" }, admin, tdb);
    await exec.create({ title: "re-1003", dueDate: "2026-03-15" }, admin, tdb);

    const page1 = await exec.list({ limit: 2, sort: "dueDate", sortDirection: "desc" }, admin, tdb);
    expect(page1.rows.map((r) => r["title"])).toEqual(["re-1003", "re-1002"]);
    expect(page1.nextCursor).not.toBeNull();

    const page2 = await exec.list(
      {
        limit: 2,
        cursor: page1.nextCursor ?? undefined,
        sort: "dueDate",
        sortDirection: "desc",
        totalCount: true,
      },
      admin,
      tdb,
    );
    expect(page2.rows.map((r) => r["title"])).toEqual(["re-1001"]);
    expect(page2.rows.map((r) => r["title"])).not.toContain("re-1003");
    // total reuses the same WHERE (cursor boundary included) as the page
    // query — this pins that the keyset boundary's extra param doesn't
    // desync the shared `params` array between the two queries.
    expect(page2.total).toBe(1);
  });

  test.each(["asc", "desc"] as const)(
    "Full sweep with ties (sort=dueDate, %s) exactly matches the reference query",
    async (direction) => {
      // Interleaved seed order (round-robin across dueDates) decorrelates
      // uuidv7 id order from dueDate order — a grouped seed (all of date A,
      // then all of date B, ...) would leave id order and asc-dueDate order
      // coincidentally identical, letting the pre-fix id-only cursor
      // boundary pass this test by accident.
      const dueDates = ["2026-01-10", "2026-02-10", "2026-03-10", "2026-04-10"];
      for (let i = 0; i < 3; i++) {
        for (const dueDate of dueDates) {
          await exec.create({ title: `tie-${dueDate}-${i}`, dueDate }, admin, tdb);
        }
      }

      const reference = await exec.list(
        { limit: 50, sort: "dueDate", sortDirection: direction },
        admin,
        tdb,
      );
      const referenceIds = reference.rows.map((r) => r["id"] as string);
      expect(referenceIds).toHaveLength(12);

      const { ids, iterations } = await collectPages("dueDate", direction, 5);
      expect(iterations).toBeLessThan(10);
      expect(ids).toEqual(referenceIds);
      expect(new Set(ids).size).toBe(12);
    },
  );

  test.each(["asc", "desc"] as const)(
    "Full sweep with NULL dueDate (%s) exactly matches the reference query",
    async (direction) => {
      const seedPlan: Array<{ title: string; dueDate?: string }> = [
        { title: "n-1" },
        { title: "d-1", dueDate: "2026-01-05" },
        { title: "n-2" },
        { title: "d-2", dueDate: "2026-02-05" },
        { title: "d-3", dueDate: "2026-01-05" },
        { title: "n-3" },
        { title: "d-4", dueDate: "2026-03-05" },
        { title: "n-4" },
        { title: "d-5", dueDate: "2026-02-05" },
      ];
      for (const row of seedPlan) {
        await exec.create(
          row.dueDate === undefined
            ? { title: row.title }
            : { title: row.title, dueDate: row.dueDate },
          admin,
          tdb,
        );
      }

      const reference = await exec.list(
        { limit: 50, sort: "dueDate", sortDirection: direction },
        admin,
        tdb,
      );
      const referenceIds = reference.rows.map((r) => r["id"] as string);
      expect(referenceIds).toHaveLength(9);

      const { ids, iterations } = await collectPages("dueDate", direction, 2);
      expect(iterations).toBeLessThan(10);
      expect(ids).toEqual(referenceIds);
      expect(new Set(ids).size).toBe(9);
    },
  );

  test("Backward compatibility: legacy id-only cursor + custom sort does not throw and falls back to the id boundary", async () => {
    const created: string[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await exec.create({ title: `legacy-${i}`, dueDate: "2026-05-01" }, admin, tdb);
      if (!res.isSuccess) throw new Error("create failed");
      created.push(String(res.data.id));
    }
    const legacyCursor = encodeCursor(created[0] as string);

    const call = exec.list({ limit: 50, cursor: legacyCursor, sort: "dueDate" }, admin, tdb);
    await expect(call).resolves.toBeDefined();

    const res = await call;
    const returnedIds = res.rows.map((r) => r["id"] as string);
    expect(returnedIds).not.toContain(created[0]);
    expect(returnedIds).toEqual(created.slice(1));
  });
});
