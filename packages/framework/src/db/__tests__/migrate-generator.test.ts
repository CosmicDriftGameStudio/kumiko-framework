import { describe, expect, test } from "bun:test";
import type { EntityTableMeta } from "../entity-table-meta";
import {
  diffSnapshots,
  generateMigration,
  renderMigrationSql,
  snapshotFromMetas,
} from "../migrate-generator";

function meta(
  tableName: string,
  extraColumn?: EntityTableMeta["columns"][number],
): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true },
      ...(extraColumn ? [extraColumn] : []),
    ],
  };
}

describe("snapshotFromMetas", () => {
  test("sorts tables by name for stable snapshots", () => {
    const snap = snapshotFromMetas([meta("zebras"), meta("apples")]);
    expect(snap.tables.map((t) => t.tableName)).toEqual(["apples", "zebras"]);
    expect(snap.version).toBe(1);
  });
});

describe("diffSnapshots", () => {
  test("null prev → all tables are new", () => {
    const next = snapshotFromMetas([meta("tasks")]);
    const diff = diffSnapshots(null, next);
    expect(diff.newTables.map((t) => t.tableName)).toEqual(["tasks"]);
    expect(diff.droppedTables).toEqual([]);
  });

  test("detects dropped table and new column", () => {
    const prev = snapshotFromMetas([meta("tasks"), meta("legacy")]);
    const next = snapshotFromMetas([
      meta("tasks", { name: "title", pgType: "text", notNull: true }),
    ]);
    const diff = diffSnapshots(prev, next);
    expect(diff.droppedTables).toEqual(["legacy"]);
    expect(diff.changedTables[0]?.newColumns.map((c) => c.name)).toEqual(["title"]);
  });
});

describe("renderMigrationSql / generateMigration", () => {
  test("emits CREATE TABLE for new tables", () => {
    const diff = diffSnapshots(null, snapshotFromMetas([meta("tasks")]));
    const sql = renderMigrationSql(diff, { name: "init", sequenceNumber: 1 });
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "tasks"');
    expect(sql).toContain("Migration 0001_init");
  });

  test("generateMigration bundles snapshot + sql", () => {
    const out = generateMigration({
      metas: [meta("tasks")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });
    expect(out.snapshot.tables).toHaveLength(1);
    expect(out.sqlContent).toContain("0001_init");
    expect(out.filename).toBe("0001_init.sql");
  });
});
