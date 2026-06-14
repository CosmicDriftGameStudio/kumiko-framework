// #356: a generated migration that adds a NOT NULL ride-along column to a
// MANAGED projection must APPLY on a populated table — where the old additive
// `ALTER TABLE ADD COLUMN ... NOT NULL` dies on existing rows. The generator
// emits DROP+CREATE for that case; the rebuild (covered by
// pending-rebuilds.integration.test.ts) refills from events afterwards.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDb, type TestDb } from "../../stack";
import type { ColumnMeta, EntityTableMeta } from "../entity-table-meta";
import { diffSnapshots, renderMigrationSql, snapshotFromMetas } from "../migrate-generator";
import { runMigrationsFromDir } from "../migrate-runner";
import { asRawClient } from "../query";

const ID_COL: ColumnMeta = { name: "id", pgType: "uuid", notNull: true, primaryKey: true };
const NAME_COL: ColumnMeta = { name: "name", pgType: "text", notNull: true };
// The studio#58/publicstatus#116 blocker shape: NOT NULL without a default.
const ENVELOPE_COL: ColumnMeta = { name: "envelope", pgType: "jsonb", notNull: true };

function managedMeta(tableName: string, columns: readonly ColumnMeta[]): EntityTableMeta {
  return { tableName, source: "managed", indexes: [], columns };
}

let testDb: TestDb;
let dir: string;

beforeAll(async () => {
  testDb = await createTestDb();
  dir = mkdtempSync(join(tmpdir(), "managed-recreate-"));
});

afterAll(async () => {
  rmSync(dir, { recursive: true, force: true });
  await testDb.cleanup();
});

describe("managed projection recreate applies on a populated table (#356)", () => {
  test("generated DROP+CREATE applies where an in-place ALTER NOT NULL dies", async () => {
    const raw = asRawClient(testDb.db);

    // A populated managed projection in its OLD shape (id, name).
    await raw.unsafe(`DROP TABLE IF EXISTS "read_proof"`);
    await raw.unsafe(`CREATE TABLE "read_proof" ("id" uuid PRIMARY KEY, "name" text NOT NULL)`);
    await raw.unsafe(
      `INSERT INTO "read_proof" (id, name) VALUES (gen_random_uuid(), 'a'), (gen_random_uuid(), 'b')`,
    );

    // Generate the migration: managed table gains `envelope NOT NULL` → DROP+CREATE.
    // (An in-place ALTER ADD COLUMN ... NOT NULL would die on the two existing
    // rows — that failure mode is exactly what #356 removes for projections.)
    const prev = snapshotFromMetas([managedMeta("read_proof", [ID_COL, NAME_COL])]);
    const next = snapshotFromMetas([managedMeta("read_proof", [ID_COL, NAME_COL, ENVELOPE_COL])]);
    const sql = renderMigrationSql(diffSnapshots(prev, next), {
      name: "add_envelope",
      sequenceNumber: 1,
    });
    expect(sql).toContain('DROP TABLE IF EXISTS "read_proof";');
    expect(sql).not.toContain("ADD COLUMN");

    writeFileSync(join(dir, "0001_add_envelope.sql"), sql);
    const result = await runMigrationsFromDir(testDb.db, dir);
    expect(result.applied).toContain("0001_add_envelope");

    // Table is back at the new shape (envelope present) and emptied — the DROP
    // ran; the queued rebuild refills it from events (proven elsewhere).
    // SQL-result boundary: shape is known from the SELECT projection.
    const colRows = (await raw.unsafe(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'read_proof'`,
    )) as readonly { column_name: string }[];
    expect(colRows.map((r) => r.column_name)).toContain("envelope");
    const countRows = (await raw.unsafe(
      `SELECT count(*)::int AS count FROM "read_proof"`,
    )) as readonly { count: number }[];
    expect(countRows[0]?.count).toBe(0);
  });
});
