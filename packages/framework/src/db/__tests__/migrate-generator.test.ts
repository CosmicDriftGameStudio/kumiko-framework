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
  source: EntityTableMeta["source"] = "unmanaged",
): EntityTableMeta {
  return {
    tableName,
    source,
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

  test("sorts by codepoint, not locale — deterministic across ICU locales (#367)", () => {
    // localeCompare orders case-insensitively ("apple" < "Zebra"); codepoint
    // puts uppercase (U+005A) before lowercase (U+0061) → "Zebra" < "apple".
    // The snapshot JSON is byte-compared and the order carries into the
    // generated migration SQL, so a revert to localeCompare would reorder the
    // committed bytes depending on the runner's ICU locale. Fails the moment
    // anyone swaps compareByCodepoint back to localeCompare.
    const snap = snapshotFromMetas([meta("apple"), meta("Zebra")]);
    expect(snap.tables.map((t) => t.tableName)).toEqual(["Zebra", "apple"]);
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

describe("renderMigrationSql — managed recreate vs unmanaged in-place", () => {
  test("managed: NOT NULL column without default → DROP+CREATE, no in-place ADD", () => {
    const prev = snapshotFromMetas([meta("read_secrets", undefined, "managed")]);
    const next = snapshotFromMetas([
      meta("read_secrets", { name: "envelope", pgType: "jsonb", notNull: true }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "secrets",
      sequenceNumber: 2,
    });
    expect(sql).toContain('DROP TABLE IF EXISTS "read_secrets";');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "read_secrets"');
    expect(sql).not.toContain("ADD COLUMN");
  });

  test("managed: column rename (drop + add NOT NULL) → DROP+CREATE with new shape", () => {
    const prev = snapshotFromMetas([
      meta("read_a", { name: "old_name", pgType: "text", notNull: true }, "managed"),
    ]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "new_name", pgType: "text", notNull: true }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "rename",
      sequenceNumber: 3,
    });
    expect(sql).toContain('DROP TABLE IF EXISTS "read_a";');
    expect(sql).toContain('"new_name"');
    expect(sql).not.toContain("DROP COLUMN");
  });

  test("managed: additive nullable column → in-place ADD COLUMN, no recreate", () => {
    const prev = snapshotFromMetas([meta("read_a", undefined, "managed")]);
    const next = snapshotFromMetas([
      meta("read_a", { name: "note", pgType: "text", notNull: false }, "managed"),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), { name: "note", sequenceNumber: 4 });
    expect(sql).toContain('ALTER TABLE "read_a" ADD COLUMN "note"');
    expect(sql).not.toContain("DROP TABLE");
  });

  test("unmanaged: NOT NULL column without default → in-place ADD (real data, never recreated)", () => {
    const prev = snapshotFromMetas([meta("app_data")]);
    const next = snapshotFromMetas([
      meta("app_data", { name: "envelope", pgType: "jsonb", notNull: true }),
    ]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "appdata",
      sequenceNumber: 5,
    });
    expect(sql).toContain('ALTER TABLE "app_data" ADD COLUMN "envelope"');
    expect(sql).not.toContain("DROP TABLE");
  });
});
