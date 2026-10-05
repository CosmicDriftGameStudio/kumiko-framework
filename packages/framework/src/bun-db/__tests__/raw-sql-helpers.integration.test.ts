// Behaviour proof for insertOnConflictDoNothing, selectInnerJoin, the jsonText
// where operator and AggregateSpec.orderByKeys against a real Postgres.
import { afterAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import type { DbRunner } from "@cosmicdrift/kumiko-types/db-connection";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import type { ColumnMeta, EntityTableMeta } from "../../db/entity-table-meta.js";
import { createTenantDb } from "../../db/tenant-db.js";
import type { TenantId } from "../../engine/types/index.js";
import {
  aggregateWhere,
  asRawClient,
  insertOnConflictDoNothing,
  insertOne,
  selectInnerJoin,
  selectMany,
} from "../query.js";
import { closeDb, getDb, makeTableMeta, renderCreateTable, uniqueTableName } from "./_helpers.js";

afterAll(async () => {
  await closeDb();
});

type TableDef = { readonly columns: readonly ColumnMeta[]; readonly extraDdl?: readonly string[] };

async function withTables<T>(
  defs: readonly TableDef[],
  fn: (ctx: { db: unknown; metas: readonly EntityTableMeta[] }) => Promise<T>,
): Promise<T> {
  const db = await getDb();
  const raw = asRawClient(db);
  const metas = defs.map((def) => makeTableMeta(uniqueTableName("rawsql"), def.columns));
  for (const [index, meta] of metas.entries()) {
    await raw.unsafe(renderCreateTable(meta));
    for (const ddl of defs[index]?.extraDdl ?? []) {
      await raw.unsafe(ddl.replaceAll("$T", `"${meta.tableName}"`));
    }
  }
  try {
    return await fn({ db, metas });
  } finally {
    for (const meta of metas) await raw.unsafe(`DROP TABLE IF EXISTS "${meta.tableName}"`);
  }
}

function only<T>(items: readonly T[]): T {
  const first = items[0];
  if (first === undefined) throw new Error("fixture: expected at least one item");
  return first;
}

function pair(metas: readonly EntityTableMeta[]): [EntityTableMeta, EntityTableMeta] {
  const [left, right] = metas;
  if (!left || !right) throw new Error("fixture: expected two tables");
  return [left, right];
}

const slugCols: readonly ColumnMeta[] = [
  { name: "slug", pgType: "text", notNull: true },
  { name: "label", pgType: "text", notNull: true },
];

describe("insertOnConflictDoNothing", () => {
  test("returns the inserted row", async () => {
    await withTables([{ columns: slugCols }], async ({ db, metas }) => {
      const row = await insertOnConflictDoNothing<{ slug: string; label: string }>(
        db,
        only(metas),
        { slug: "a", label: "first" },
      );
      expect(row?.slug).toBe("a");
      expect(row?.label).toBe("first");
    });
  });

  test("conflict on the PK returns undefined and leaves the existing row untouched", async () => {
    await withTables([{ columns: slugCols }], async ({ db, metas }) => {
      const table = only(metas);
      const id = randomUUID();
      await insertOne(db, table, { id, slug: "a", label: "original" });
      const second = await insertOnConflictDoNothing(db, table, { id, slug: "b", label: "other" });
      expect(second).toBeUndefined();
      const rows = await selectMany<{ slug: string; label: string }>(db, table, { id });
      expect(rows).toHaveLength(1);
      expect(only(rows).slug).toBe("a");
      expect(only(rows).label).toBe("original");
    });
  });

  test("conflictKeys targets a non-PK unique column", async () => {
    await withTables(
      [{ columns: slugCols, extraDdl: ['CREATE UNIQUE INDEX ON $T ("slug")'] }],
      async ({ db, metas }) => {
        const table = only(metas);
        await insertOne(db, table, { slug: "dup", label: "original" });
        const second = await insertOnConflictDoNothing(
          db,
          table,
          { slug: "dup", label: "other" },
          { conflictKeys: ["slug"] },
        );
        expect(second).toBeUndefined();
        const fresh = await insertOnConflictDoNothing<{ label: string }>(
          db,
          table,
          { slug: "new", label: "x" },
          { conflictKeys: ["slug"] },
        );
        expect(fresh?.label).toBe("x");
        const rows = await selectMany<{ label: string }>(db, table, { slug: "dup" });
        expect(rows.map((r) => r.label)).toEqual(["original"]);
      },
    );
  });

  test("rejects a tenant-scoped db", async () => {
    await withTables([{ columns: slugCols }], async ({ db, metas }) => {
      const tenantDb = createTenantDb(db as DbRunner, randomUUID() as TenantId);
      await expect(
        insertOnConflictDoNothing(tenantDb, only(metas), { slug: "a", label: "b" }),
      ).rejects.toThrow(/insertOnConflictDoNothing/);
    });
  });
});

const ownerCols: readonly ColumnMeta[] = [
  { name: "owner_ref", pgType: "uuid", notNull: true },
  { name: "region", pgType: "text", notNull: true },
  { name: "label", pgType: "text", notNull: true },
];
const targetCols: readonly ColumnMeta[] = [
  { name: "owner_ref", pgType: "text", notNull: true },
  { name: "region", pgType: "text", notNull: true },
  { name: "secret_note", pgType: "text", notNull: false },
  { name: "created_at", pgType: "timestamptz", notNull: true, defaultSql: "now()" },
];
const joinTables: readonly TableDef[] = [{ columns: ownerCols }, { columns: targetCols }];
const ownerOn = [{ left: "ownerRef", right: "ownerRef" }] as const;

describe("selectInnerJoin", () => {
  async function seedJoin(
    db: unknown,
    left: EntityTableMeta,
    right: EntityTableMeta,
  ): Promise<{ ownerA: string; ownerB: string }> {
    const ownerA = randomUUID();
    const ownerB = randomUUID();
    const ownerC = randomUUID();
    await insertOne(db, left, { ownerRef: ownerA, region: "eu", label: "a" });
    await insertOne(db, left, { ownerRef: ownerB, region: "us", label: "b" });
    await insertOne(db, left, { ownerRef: ownerC, region: "eu", label: "c-no-partner" });
    await insertOne(db, right, { ownerRef: ownerA, region: "eu", secretNote: "note-a" });
    await insertOne(db, right, { ownerRef: ownerB, region: "eu", secretNote: "note-b" });
    return { ownerA, ownerB };
  }

  test("inner semantics: only rows with a partner; uuid vs text joins via ::text", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      const { ownerA, ownerB } = await seedJoin(db, left, right);
      const rows = await selectInnerJoin<{ label: string; ownerRef: string }>(db, {
        left,
        right,
        on: [{ left: "ownerRef", right: "ownerRef" }],
      });
      expect(rows.map((r) => r.left.label).sort()).toEqual(["a", "b"]);
      expect(rows.map((r) => r.left.ownerRef).sort()).toEqual([ownerA, ownerB].sort());
    });
  });

  test("two ON pairs, side filters, projection without leaks", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      await seedJoin(db, left, right);
      const both = await selectInnerJoin(db, {
        left,
        right,
        on: [
          { left: "ownerRef", right: "ownerRef" },
          { left: "region", right: "region" },
        ],
        leftFields: ["label"],
        rightFields: ["secretNote"],
      });
      // owner b matches on owner_ref but not on region (us vs eu)
      expect(both).toHaveLength(1);
      expect(only(both).left).toEqual({ label: "a" });
      expect(only(both).right).toEqual({ secretNote: "note-a" });

      const filtered = await selectInnerJoin<{ label: string }, { secretNote: string }>(db, {
        left,
        right,
        on: ownerOn,
        leftWhere: { label: "b" },
        rightWhere: { secretNote: "note-b" },
        leftFields: ["label"],
        rightFields: ["secretNote"],
      });
      expect(filtered).toHaveLength(1);
      expect(only(filtered).right.secretNote).toBe("note-b");

      const noHit = await selectInnerJoin(db, {
        left,
        right,
        on: ownerOn,
        leftWhere: { label: "a" },
        rightWhere: { secretNote: "note-b" },
      });
      expect(noHit).toEqual([]);

      const defaults = await selectInnerJoin(db, {
        left,
        right,
        on: ownerOn,
        leftWhere: { label: "a" },
      });
      expect(Object.keys(only(defaults).right)).toEqual([]);
      expect(Object.keys(only(defaults).left).sort()).toEqual([
        "id",
        "label",
        "ownerRef",
        "region",
      ]);
    });
  });

  test("coerces timestamptz on the right side and honours limit", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      await seedJoin(db, left, right);
      const rows = await selectInnerJoin<unknown, { createdAt: Temporal.Instant }>(db, {
        left,
        right,
        on: ownerOn,
        rightFields: ["createdAt"],
        limit: 1,
      });
      expect(rows).toHaveLength(1);
      expect(only(rows).right.createdAt).toBeInstanceOf(Temporal.Instant);
    });
  });

  test("throws on unknown fields and invalid limit", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      await expect(
        selectInnerJoin(db, { left, right, on: ownerOn, rightFields: ["nope"] }),
      ).rejects.toThrow(/nope/);
      await expect(
        selectInnerJoin(db, { left, right, on: [{ left: "ownerRef", right: "nope" }] }),
      ).rejects.toThrow(/nope/);
      await expect(selectInnerJoin(db, { left, right, on: ownerOn, limit: -1 })).rejects.toThrow(
        /limit/,
      );
    });
  });

  test("rejects a tenant-scoped db", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      const tenantDb = createTenantDb(db as DbRunner, randomUUID() as TenantId);
      await expect(selectInnerJoin(tenantDb, { left, right, on: ownerOn })).rejects.toThrow(
        /selectInnerJoin/,
      );
    });
  });

  test("binds SQL metacharacters as values", async () => {
    await withTables(joinTables, async ({ db, metas }) => {
      const [left, right] = pair(metas);
      await seedJoin(db, left, right);
      const rows = await selectInnerJoin(db, {
        left,
        right,
        on: ownerOn,
        leftWhere: { label: "'; DROP TABLE x; --" },
        rightWhere: { secretNote: "'; DROP TABLE x; --" },
      });
      expect(rows).toEqual([]);
      expect(await selectMany(db, left)).toHaveLength(3);
    });
  });
});

const docCols: readonly ColumnMeta[] = [
  { name: "tenant_id", pgType: "uuid", notNull: true },
  { name: "payload", pgType: "jsonb", notNull: true },
  { name: "label", pgType: "text", notNull: false },
  { name: "created_at", pgType: "timestamptz", notNull: true },
];

describe("where jsonText", () => {
  async function seedDocs(db: unknown, table: EntityTableMeta, tenantId: string): Promise<void> {
    await insertOne(db, table, {
      tenantId,
      payload: { handlerName: "h1", respondedModel: "m-resp", requestedModel: "m-req" },
      label: "both",
      createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
    });
    await insertOne(db, table, {
      tenantId,
      payload: { handlerName: "h1", requestedModel: "m-req" },
      label: "only-requested",
      createdAt: Temporal.Instant.from("2026-01-02T00:00:00Z"),
    });
    await insertOne(db, table, {
      tenantId,
      payload: { handlerName: "h2", respondedModel: "m-resp" },
      label: "other-handler",
      createdAt: Temporal.Instant.from("2026-01-03T00:00:00Z"),
    });
  }

  async function labelsFor(
    db: unknown,
    table: EntityTableMeta,
    payload: unknown,
  ): Promise<string[]> {
    const rows = await selectMany<{ label: string }>(db, table, { payload });
    return rows.map((r) => r.label).sort();
  }

  test("single key", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      await seedDocs(db, table, randomUUID());
      expect(await labelsFor(db, table, { jsonText: { keys: ["handlerName"], eq: "h2" } })).toEqual(
        ["other-handler"],
      );
    });
  });

  test("multiple matches combine with AND", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      await seedDocs(db, table, randomUUID());
      expect(
        await labelsFor(db, table, {
          jsonText: [
            { keys: ["handlerName"], eq: "h1" },
            { keys: ["requestedModel"], eq: "m-req" },
          ],
        }),
      ).toEqual(["both", "only-requested"]);
      expect(
        await labelsFor(db, table, {
          jsonText: [
            { keys: ["handlerName"], eq: "h2" },
            { keys: ["requestedModel"], eq: "m-req" },
          ],
        }),
      ).toEqual([]);
    });
  });

  test("COALESCE: first non-null key wins, later keys are only a fallback", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      await seedDocs(db, table, randomUUID());
      const keys = ["respondedModel", "requestedModel"] as const;
      // "only-requested" has no respondedModel -> falls back to requestedModel
      expect(await labelsFor(db, table, { jsonText: { keys, eq: "m-req" } })).toEqual([
        "only-requested",
      ]);
      // "both" has respondedModel set -> its requestedModel is ignored
      expect(await labelsFor(db, table, { jsonText: { keys, eq: "m-resp" } })).toEqual([
        "both",
        "other-handler",
      ]);
    });
  });

  test("throws on non-jsonb column, combined operators and malformed matches", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      await expect(
        selectMany(db, table, { label: { jsonText: { keys: ["a"], eq: "x" } } }),
      ).rejects.toThrow(/label/);
      await expect(
        selectMany(db, table, { payload: { ne: "x", jsonText: { keys: ["a"], eq: "x" } } }),
      ).rejects.toThrow(/jsonText/);
      await expect(
        selectMany(db, table, { payload: { jsonText: { keys: [], eq: "x" } } }),
      ).rejects.toThrow(/jsonText/);
    });
  });

  test("TenantDb path only returns the own tenant's rows", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      const mine = randomUUID();
      await seedDocs(db, table, mine);
      await seedDocs(db, table, randomUUID());
      const tenantDb = createTenantDb(db as DbRunner, mine as TenantId);
      const rows = await tenantDb.selectMany<{ tenantId: string }>(table, {
        payload: { jsonText: { keys: ["handlerName"], eq: "h1" } },
      });
      expect(rows).toHaveLength(2);
      expect(rows.every((r) => r.tenantId === mine)).toBe(true);
    });
  });

  test("keys and eq with SQL metacharacters are bound, not interpolated", async () => {
    await withTables([{ columns: docCols }], async ({ db, metas }) => {
      const table = only(metas);
      const evil = "x'); DROP TABLE y; --";
      await insertOne(db, table, {
        tenantId: randomUUID(),
        payload: { [evil]: evil },
        label: "evil",
        createdAt: Temporal.Instant.from("2026-01-01T00:00:00Z"),
      });
      expect(await labelsFor(db, table, { jsonText: { keys: [evil], eq: evil } })).toEqual([
        "evil",
      ]);
      expect(await labelsFor(db, table, { jsonText: { keys: [evil], eq: "other" } })).toEqual([]);
    });
  });
});

describe("aggregateWhere orderByKeys", () => {
  const eventCols: readonly ColumnMeta[] = [
    { name: "occurred_at", pgType: "timestamptz", notNull: true },
  ];
  async function seedTimes(db: unknown, table: EntityTableMeta): Promise<void> {
    for (const day of ["01", "02", "03", "04"]) {
      await insertOne(db, table, { occurredAt: Temporal.Instant.from(`2026-02-${day}T00:00:00Z`) });
    }
  }

  test("desc + limit returns the newest keys first, capped", async () => {
    await withTables([{ columns: eventCols }], async ({ db, metas }) => {
      const table = only(metas);
      await seedTimes(db, table);
      const rows = await aggregateWhere(db, table, {
        measure: { fn: "count" },
        groupBy: [{ field: "occurredAt" }],
        orderByKeys: "desc",
        limit: 2,
      });
      expect(rows.map((r) => Date.parse(String(r.keys[0])))).toEqual([
        Date.parse("2026-02-04T00:00:00Z"),
        Date.parse("2026-02-03T00:00:00Z"),
      ]);
    });
  });

  test("default stays ascending and an invalid direction throws", async () => {
    await withTables([{ columns: eventCols }], async ({ db, metas }) => {
      const table = only(metas);
      await seedTimes(db, table);
      const asc = await aggregateWhere(db, table, {
        measure: { fn: "count" },
        groupBy: [{ field: "occurredAt" }],
        limit: 1,
      });
      expect(Date.parse(String(only(asc).keys[0]))).toBe(Date.parse("2026-02-01T00:00:00Z"));
      await expect(
        aggregateWhere(db, table, {
          measure: { fn: "count" },
          groupBy: [{ field: "occurredAt" }],
          // @ts-expect-error deliberately invalid to prove the runtime guard
          orderByKeys: "sideways",
        }),
      ).rejects.toThrow(/orderByKeys/);
    });
  });
});
