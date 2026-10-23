import { afterAll, afterEach, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta.ts";
import {
  type GenerateMigrationOutput,
  generateMigration,
  loadSnapshotJson,
  writeSnapshotJson,
} from "../migrate-generator.ts";
import type { RowLevelSecurityMode } from "../render-rls-ddl.ts";

function tenantTable(
  tableName: string,
  options: { source?: EntityTableMeta["source"]; extraNotNullColumn?: boolean } = {},
): EntityTableMeta {
  return {
    tableName,
    source: options.source ?? "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      { name: "tenant_id", pgType: "uuid", notNull: true },
      ...(options.extraNotNullColumn
        ? [{ name: "extra", pgType: "text" as const, notNull: true }]
        : []),
    ],
  };
}

const globalTable: EntityTableMeta = {
  tableName: "store_global",
  source: "unmanaged",
  indexes: [],
  columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
};

function generate(
  metas: readonly EntityTableMeta[],
  prev: GenerateMigrationOutput | null,
  rowLevelSecurity?: RowLevelSecurityMode,
): GenerateMigrationOutput {
  return generateMigration({
    metas,
    prevSnapshot: prev?.snapshot ?? null,
    name: "step",
    sequenceNumber: prev === null ? 1 : 2,
    ...(rowLevelSecurity !== undefined && { rowLevelSecurity }),
  });
}

beforeAll(() => setSystemTime(new Date("2026-01-01T00:00:00.000Z")));
afterEach(() => setSystemTime(new Date("2026-01-01T00:00:00.000Z")));
afterAll(() => setSystemTime());

describe("generateMigration with row level security", () => {
  const items = tenantTable("store_items");
  const orders = tenantTable("store_orders");

  test("off is byte-identical to calling without the option and writes no snapshot key", () => {
    const plain = generate([items, globalTable], null);
    const off = generate([items, globalTable], null, "off");
    expect(off.sqlContent).toBe(plain.sqlContent);
    expect(off.snapshot).toEqual(plain.snapshot);
    expect(Object.hasOwn(off.snapshot, "rowLevelSecurity")).toBe(false);
    expect(off.rowLevelSecurityChanges).toEqual([]);
    expect(plain.sqlContent).not.toContain("POLICY");
  });

  test("on writes an RLS section for every tenant table of the initial migration", () => {
    const result = generate([items, globalTable, orders], null, "on");
    expect(result.sqlContent).toContain("-- === Row level security ===");
    expect(result.sqlContent).toContain("-- store_items");
    expect(result.sqlContent).toContain("-- store_orders");
    expect(result.sqlContent).not.toContain("-- store_global\n");
    expect(result.sqlContent).toContain(`ALTER TABLE "store_items" FORCE ROW LEVEL SECURITY;`);
    expect(Object.keys(result.snapshot.rowLevelSecurity ?? {})).toEqual([
      "store_items",
      "store_orders",
    ]);
    const lastKey = Object.keys(result.snapshot).at(-1);
    expect(lastKey).toBe("rowLevelSecurity");
    expect(result.sqlContent.indexOf("-- === New tables ===")).toBeLessThan(
      result.sqlContent.indexOf("-- === Row level security ==="),
    );
  });

  test("on to on without changes detects no schema changes", () => {
    const first = generate([items], null, "on");
    const second = generate([items], first, "on");
    expect(second.rowLevelSecurityChanges).toEqual([]);
    expect(second.sqlContent).toContain("-- No schema changes detected.");
  });

  test("off to on enables RLS on the existing table", () => {
    const first = generate([items], null, "off");
    const second = generate([items], first, "on");
    expect(second.rowLevelSecurityChanges.map((c) => c.kind)).toEqual(["enable"]);
    expect(second.sqlContent).toContain(`ALTER TABLE "store_items" ENABLE ROW LEVEL SECURITY;`);
    expect(second.sqlContent).not.toContain("No schema changes");
  });

  test("on to off disables RLS with a warning", () => {
    const first = generate([items], null, "on");
    const second = generate([items], first, "off");
    expect(second.rowLevelSecurityChanges.map((c) => c.kind)).toEqual(["disable"]);
    expect(second.sqlContent).toContain("-- WARN: row level security switched off");
    expect(second.sqlContent).toContain(
      `DROP POLICY IF EXISTS "kumiko_tenant_isolation" ON "store_items";`,
    );
    expect(second.sqlContent).toContain(`ALTER TABLE "store_items" NO FORCE ROW LEVEL SECURITY;`);
    expect(second.sqlContent).toContain(`ALTER TABLE "store_items" DISABLE ROW LEVEL SECURITY;`);
    expect(Object.hasOwn(second.snapshot, "rowLevelSecurity")).toBe(false);
  });

  test("a recreated managed table enables RLS again", () => {
    const before = tenantTable("read_items", { source: "managed" });
    const after = tenantTable("read_items", { source: "managed", extraNotNullColumn: true });
    const first = generate([before], null, "on");
    const second = generate([after], first, "on");
    expect(second.sqlContent).toContain(`DROP TABLE IF EXISTS "read_items";`);
    expect(second.rowLevelSecurityChanges).toHaveLength(1);
    expect(second.rowLevelSecurityChanges[0]).toMatchObject({
      kind: "enable",
      tableName: "read_items",
    });
    expect(second.rowLevelSecurityChanges[0]).not.toHaveProperty("previous");
    expect(second.sqlContent).toContain(`ALTER TABLE "read_items" FORCE ROW LEVEL SECURITY;`);
  });

  test("a changed spec drops the policy that disappeared", () => {
    const first = generate([items], null, "on");
    const staleSnapshot = {
      ...first.snapshot,
      rowLevelSecurity: {
        store_items: {
          policies: [
            ...(first.snapshot.rowLevelSecurity?.["store_items"]?.policies ?? []),
            {
              name: "legacy_policy",
              command: "ALL" as const,
              kind: "PERMISSIVE" as const,
              rolesSql: "PUBLIC",
              using: "true",
            },
          ],
        },
      },
    };
    const second = generateMigration({
      metas: [items],
      prevSnapshot: staleSnapshot,
      name: "step",
      sequenceNumber: 2,
      rowLevelSecurity: "on",
    });
    expect(second.sqlContent).toContain(`DROP POLICY IF EXISTS "legacy_policy" ON "store_items";`);
    expect(second.sqlContent).not.toContain(`CREATE POLICY "legacy_policy"`);
  });

  test("a dropped table produces no RLS statements", () => {
    const first = generate([items, orders], null, "on");
    const second = generate([items], first, "on");
    expect(second.diff.droppedTables).toEqual(["store_orders"]);
    expect(second.rowLevelSecurityChanges).toEqual([]);
    expect(second.sqlContent).not.toContain("Row level security");
  });
});

describe("snapshot persistence of rowLevelSecurity", () => {
  const dir = mkdtempSync(join(tmpdir(), "rls-snapshot-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  test("roundtrips through writeSnapshotJson and loadSnapshotJson", () => {
    const snapshot = generate([tenantTable("store_items")], null, "on").snapshot;
    const path = join(dir, "roundtrip.json");
    writeSnapshotJson(path, snapshot);
    expect(loadSnapshotJson(path)).toEqual(snapshot);
  });

  test("a malformed rowLevelSecurity block makes loadSnapshotJson throw", () => {
    const path = join(dir, "malformed.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        tables: [],
        rowLevelSecurity: { store_items: { policies: [{ name: "p", command: "TRUNCATE" }] } },
      }),
    );
    expect(() => loadSnapshotJson(path)).toThrow(/malformed/);
  });
});
