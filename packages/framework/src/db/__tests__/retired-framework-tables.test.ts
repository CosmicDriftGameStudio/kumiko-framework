import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EntityTableMeta } from "../entity-table-meta.js";
import { generateMigration, snapshotFromMetas } from "../migrate-generator.js";
import { replayMigrationsDir } from "../replay-migration-sql.js";
import { findCommentedDropTables, findRetiredTableDrops } from "../retired-framework-tables.js";

const CREATE_RETIRED = `CREATE TABLE IF NOT EXISTS "read_job_runs" ("id" uuid PRIMARY KEY);`;
const COMMENTED_RETIRED_DROP = `-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_job_runs";  -- uncomment + ensure backup`;
const EXECUTABLE_RETIRED_DROP = `DROP TABLE IF EXISTS "read_job_runs";`;

function meta(tableName: string): EntityTableMeta {
  return {
    tableName,
    source: "unmanaged",
    indexes: [],
    columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }],
  };
}

const snapshotWithout = snapshotFromMetas([meta("store_job_runs")]);

describe("findRetiredTableDrops", () => {
  test("(b) a CREATE TABLE in an earlier migration qualifies the table", () => {
    const drops = findRetiredTableDrops([CREATE_RETIRED], snapshotWithout);
    expect(drops.map((d) => d.tableName)).toEqual(["read_job_runs"]);
  });

  test("(b) a commented DESTRUCTIVE drop qualifies the table", () => {
    const drops = findRetiredTableDrops([COMMENTED_RETIRED_DROP], snapshotWithout);
    expect(drops.map((d) => d.tableName)).toEqual(["read_job_runs"]);
  });

  test("(b) a table no migration ever mentioned is left alone", () => {
    expect(findRetiredTableDrops(["SELECT 1;"], snapshotWithout)).toEqual([]);
  });

  test("(a) an earlier executable drop means it is already done", () => {
    const drops = findRetiredTableDrops(
      [CREATE_RETIRED, COMMENTED_RETIRED_DROP, EXECUTABLE_RETIRED_DROP],
      snapshotWithout,
    );
    expect(drops).toEqual([]);
  });

  test("(a) a re-create after an executable drop needs a new drop", () => {
    const drops = findRetiredTableDrops(
      [CREATE_RETIRED, EXECUTABLE_RETIRED_DROP, CREATE_RETIRED],
      snapshotWithout,
    );
    expect(drops.map((d) => d.tableName)).toEqual(["read_job_runs"]);
  });

  test("(c) a table the current schema still declares is not dropped", () => {
    const snapshot = snapshotFromMetas([meta("read_job_runs")]);
    expect(findRetiredTableDrops([CREATE_RETIRED], snapshot)).toEqual([]);
  });

  test("an app table with a commented drop is never auto-dropped", () => {
    expect(
      findRetiredTableDrops(
        [`-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_orders";  -- uncomment`],
        snapshotWithout,
      ),
    ).toEqual([]);
  });
});

describe("generateMigration with retired framework tables", () => {
  test("writes an executable drop even when the diff is otherwise empty", () => {
    const prevSnapshot = snapshotFromMetas([meta("store_job_runs")]);
    const result = generateMigration({
      metas: [meta("store_job_runs")],
      prevSnapshot,
      name: "retire",
      sequenceNumber: 2,
      priorMigrationsSql: [COMMENTED_RETIRED_DROP],
    });
    expect(result.retiredDrops.map((d) => d.tableName)).toEqual(["read_job_runs"]);
    expect(result.sqlContent).toContain(`\n${EXECUTABLE_RETIRED_DROP}\n`);
    expect(result.sqlContent).not.toContain("No schema changes detected");
  });

  test("app tables dropped from the schema stay commented out", () => {
    const result = generateMigration({
      metas: [],
      prevSnapshot: snapshotFromMetas([meta("read_orders")]),
      name: "drop-orders",
      sequenceNumber: 2,
      priorMigrationsSql: [`CREATE TABLE "read_orders" ("id" uuid);`],
    });
    expect(result.retiredDrops).toEqual([]);
    expect(result.sqlContent).toContain(`-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_orders";`);
    expect(result.sqlContent).not.toMatch(/^DROP TABLE/m);
  });

  test("without prior migrations nothing is dropped", () => {
    const result = generateMigration({
      metas: [meta("store_job_runs")],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });
    expect(result.retiredDrops).toEqual([]);
  });
});

describe("findCommentedDropTables", () => {
  test("reports only tables gone from the snapshot", () => {
    const snapshot = snapshotFromMetas([meta("read_kept")]);
    const names = findCommentedDropTables(
      [
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_gone";`,
        `-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_kept";`,
      ],
      snapshot,
    );
    expect(names).toEqual(["read_gone"]);
  });
});

describe("replay and drift accept an executable drop of a table missing from the snapshot", () => {
  test("replayMigrationsDir removes the dropped table", () => {
    const dir = mkdtempSync(join(tmpdir(), "retired-replay-"));
    try {
      writeFileSync(join(dir, "0001_init.sql"), CREATE_RETIRED);
      writeFileSync(join(dir, "0002_retire.sql"), EXECUTABLE_RETIRED_DROP);
      expect([...replayMigrationsDir(dir).keys()]).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
