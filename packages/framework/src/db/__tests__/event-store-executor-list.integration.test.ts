// Direkter Coverage für die Tier-2.6d-Erweiterung von executor.list:
// offset, totalCount, sowie das "cursor wins über offset" Verhalten.
// Vor dieser Suite waren die drei Branches nur indirekt über
// items-create.integration im Showcase abgedeckt — nicht ausreichend
// für Framework-Code der von jeder App genutzt wird.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../../db/query";
import {
  createDateField,
  createEntity,
  createNumberField,
  createTextField,
  SYSTEM_TENANT_ID,
} from "../../engine";
import { UnprocessableError } from "../../errors";
import { createEventsTable } from "../../event-store";
import { TestUsers, unsafeCreateEntityTable } from "../../stack";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { encodeCursor } from "../cursor";
import { createEventStoreExecutor } from "../event-store-executor";
import { buildEntityTable } from "../table-builder";
import { createTenantDb, type TenantDb } from "../tenant-db";

const entity = createEntity({
  table: "read_pager_items",
  fields: {
    title: createTextField({ required: true, sortable: true }),
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
  await createEventsTable(testDb.db);
  tdb = createTenantDb(testDb.db, admin.tenantId);
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

  test("ohne totalCount: response hat KEIN total-Feld (extra COUNT gespart)", async () => {
    await seed(5);
    const res = await exec.list({ limit: 50 }, admin, tdb);
    expect(res.rows).toHaveLength(5);
    expect("total" in res).toBe(false);
  });

  test("mit totalCount=true: response hat total = N", async () => {
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

  test("offset >= total: leere rows, total bleibt korrekt", async () => {
    await seed(3);
    const res = await exec.list(
      { limit: 10, offset: 100, sort: "rank", sortDirection: "asc", totalCount: true },
      admin,
      tdb,
    );
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(3);
  });

  test("cursor wins über offset (kombination ist Caller-bug, defensiv)", async () => {
    // Wenn der Caller versehentlich BEIDE setzt — z.B. ein Migrations-
    // Skript das Cursor-Pagination + Page-Number mischt — soll cursor
    // gewinnen weil DB-stable. Offset wird ignoriert.
    await seed(10);
    const first = await exec.list({ limit: 3, sort: "rank", sortDirection: "asc" }, admin, tdb);
    expect(first.rows.map((r) => r["rank"])).toEqual([0, 1, 2]);
    const cursor = first.nextCursor;
    expect(cursor).not.toBeNull();
    if (cursor === null) return;
    // cursor + offset:50 — cursor sollte gewinnen, nicht das offset.
    // Note: cursor-pagination hier ist NICHT row-3 → row-4-stable, weil
    // die UUIDs zwar UUIDv7 sind aber innerhalb derselben Millisekunde
    // generiert die Sub-Sort nicht garantiert mit `rank` korreliert. Wir
    // pinnen nur "cursor wird benutzt → kein offset:50-Skip auf row-50
    // (die's gar nicht gibt)".
    const next = await exec.list(
      { limit: 3, cursor, offset: 50, sort: "rank", sortDirection: "asc" },
      admin,
      tdb,
    );
    // Ohne cursor-wins-Branch wäre das offset=50 → leeres Result.
    // Mit cursor-wins läuft der gt(id, cursor)-Filter und liefert
    // rows die NACH dem cursor kommen → mindestens 1 Eintrag.
    expect(next.rows.length).toBeGreaterThan(0);
  });

  test("totalCount auf empty-result: total=0, rows=[]", async () => {
    const res = await exec.list({ limit: 50, totalCount: true }, admin, tdb);
    expect(res.rows).toHaveLength(0);
    expect(res.total).toBe(0);
  });
});

describe("event-store-executor.list — stable order (#2198)", () => {
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  test("offset paging mit identischem sort-Wert: keine Row auf beiden Seiten, Union = alle Rows", async () => {
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

  test("cursor paging ohne sort: jede Row genau einmal", async () => {
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

  test("filter eq: nur die rank=5 row", async () => {
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

  test("filter ne: alle außer rank=2", async () => {
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

  test("filter in mit empty-array: leeres Resultat (keine Match-All-Falle)", async () => {
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

  test("filter ne mit value null: matcht rows mit gesetztem Feld (#2015)", async () => {
    // #2015: rank is optional — pre-fix, `ne` compiled to `rank <> NULL`,
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

  test("filter eq mit value null: matcht rows mit ungesetztem Feld (#2015)", async () => {
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

  test("filter unknown-field: silent skip — kein Crash, alle rows zurück", async () => {
    // Boot-Validator pinst das normalerweise; Runtime-Defense für den
    // Fall dass ein Test/Caller direkt am executor vorbei ein bogus-
    // Field schickt. Lieber alle rows als Crash-Loop.
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

  test("filters[] AND: zwei dynamische Filter werden mit AND verknüpft", async () => {
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

  test("statischer filter + dynamische filters[] kombinieren mit AND", async () => {
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
    // gt:2 AND in[1,3,5,9] → 3,5,9 (1 fällt durch gt:2 raus)
    expect(res.rows.map((r) => r["rank"])).toEqual([3, 5, 9]);
  });

  test("filters[] mit leerem in-Array: leeres Resultat (kein Match-All)", async () => {
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

describe("event-store-executor.list — runtime SearchAdapter (Tier 2.7e Audit-Fix #1)", () => {
  // Pinst dass der executor einen searchAdapter aus runtimeOptions
  // akzeptiert wenn er beim Build keinen über options.searchAdapter
  // bekommen hat. defaultEntityQueryHandler nutzt diesen Pfad weil
  // der executor zur Definition-Time keinen ctx-Adapter kennt.
  const exec = createEventStoreExecutor(table, entity, { entityName: "pagerItem" });

  test("ohne searchAdapter: search-Param wirft statt still zu verpuffen (#2032)", async () => {
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

  test("mit runtimeOptions.searchAdapter: search filtert auf returned IDs", async () => {
    for (let i = 0; i < 3; i++) {
      await exec.create({ title: `item-${i}`, rank: i }, admin, tdb);
    }
    const allRows = await exec.list({ limit: 50 }, admin, tdb);
    const matchedId = allRows.rows[1]?.["id"] as string;
    expect(matchedId).toBeDefined();

    // Mock-Adapter: returnt genau eine ID — nur die wird durchgelassen.
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

  test("mit search ohne match (Adapter returnt []): leere rows + no DB-Query", async () => {
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

  test("system-mode list: search uses SYSTEM_TENANT_ID (not session tenant)", async () => {
    const systemTdb = createTenantDb(testDb.db, admin.tenantId, "system");
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
    expect(searchedTenant).toBe(SYSTEM_TENANT_ID);
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
});

describe("event-store-executor.list — keyset cursor mit custom sort (#2265)", () => {
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

  test("Issue-Repro: Seite 2 dupliziert nicht mehr die letzte Zeile von Seite 1 und überspringt nicht die älteste", async () => {
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
    "Voll-Sweep mit Ties (sort=dueDate, %s) matcht die Referenz-Abfrage exakt",
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
    "Voll-Sweep mit NULL dueDate (%s) matcht die Referenz-Abfrage exakt",
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

  test("Rückwärtskompatibilität: legacy id-only Cursor + custom sort wirft nicht und fällt auf die id-Grenze zurück", async () => {
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
