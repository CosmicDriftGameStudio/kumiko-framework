// Integration test for the drizzle-free boot gate (detectKumikoDrift /
// assertKumikoSchemaCurrent). In production, this gate blocks container starts:
// every false positive blocks boot, while every false negative lets schema drift
// through.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { deriveEntityTableMeta } from "../../db/entity-table-meta.ts";
import { generateMigration, writeSnapshotJson } from "../../db/migrate-generator.ts";
import {
  baselineMigrations,
  loadMigrationsFromDir,
  runMigrationsFromDir,
} from "../../db/migrate-runner.ts";
import { asRawClient } from "../../db/query.ts";
import { tableExists } from "../../db/schema-inspection.ts";
import { createEntity, createTextField } from "../../engine/index.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { assertKumikoSchemaCurrent, detectKumikoDrift, SchemaDriftError } from "../kumiko-drift.ts";

let testDb: BunTestDb;
let dir: string;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), "kumiko-mig-"));
  // Reset the tracking table and test tables for each test to ensure isolation.
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "_kumiko_migrations"`);
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "kdrift_widget"`);
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "kdrift_gen"`);
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "kdriftMixed"`);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeMigration(file: string, sql: string): void {
  writeFileSync(join(dir, file), sql);
}

function writeSnapshot(tableNames: readonly string[]): void {
  const tables = tableNames.map((tableName) => ({ tableName, columns: [] }));
  writeFileSync(join(dir, ".snapshot.json"), JSON.stringify({ version: 1, tables }));
}

describe("kumiko-drift boot-gate", () => {
  test("applied + table exists → ok", async () => {
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);
    await runMigrationsFromDir(testDb.db, dir);

    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).resolves.toBeUndefined();
  });

  test("checked-in migration not applied → pending drift", async () => {
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);
    // NICHT applyen.
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.pending).toEqual(["0001_init"]);
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).rejects.toBeInstanceOf(
      SchemaDriftError,
    );
  });

  test("applied migration edited afterwards → checksum mismatch", async () => {
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);
    await runMigrationsFromDir(testDb.db, dir);

    // Edit the file afterwards (different content means a different checksum).
    writeMigration(
      "0001_init.sql",
      `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY, "x" int);`,
    );
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.checksumMismatches.map((m) => m.id)).toEqual(["0001_init"]);
  });

  test("snapshot table missing in DB → missingTables", async () => {
    writeMigration("0001_init.sql", `SELECT 1;`); // applied, but does not create the table
    writeSnapshot(["kdrift_widget"]);
    await runMigrationsFromDir(testDb.db, dir);

    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.missingTables).toEqual(["kdrift_widget"]);
  });

  test("snapshot column missing in DB → missingColumns (Layer 3, boot-fail not 500)", async () => {
    // This case: table was migrated from a thin snapshot, the snapshot is
    // now richer (ride-along columns the generator started emitting). The table
    // EXISTS (Layer 2 ok) but lacks columns the code will write → without
    // Layer 3 this surfaces as a runtime-500 on the first write. Layer 3 makes
    // it a boot-time SchemaDriftError with a regen-hint instead.
    await asRawClient(testDb.db).unsafe(
      `CREATE TABLE "kdrift_widget" ("id" uuid PRIMARY KEY, "key" text)`,
    );
    writeMigration("0001_init.sql", `SELECT 1;`); // recorded, table pre-exists thin
    writeFileSync(
      join(dir, ".snapshot.json"),
      JSON.stringify({
        version: 1,
        tables: [
          {
            tableName: "kdrift_widget",
            columns: [
              { name: "id", pgType: "uuid", notNull: true },
              { name: "key", pgType: "text", notNull: true },
              { name: "envelope", pgType: "jsonb", notNull: true },
              { name: "metadata", pgType: "jsonb", notNull: true },
            ],
            indexes: [],
            source: "managed",
          },
        ],
      }),
    );
    await runMigrationsFromDir(testDb.db, dir);

    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.missingTables).toEqual([]);
    expect(report.missingColumns).toEqual([
      { table: "kdrift_widget", columns: ["envelope", "metadata"] },
    ]);
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).rejects.toBeInstanceOf(
      SchemaDriftError,
    );
  });

  test("missing migrations dir → ok (no migrations to validate)", async () => {
    // Regression: an existing-app upgrade without
    // ./kumiko/migrations must not throw a raw ENOENT (which would produce a
    // plain Error instead of SchemaDriftError and omit the remediation hint from
    // the boot log).
    rmSync(dir, { recursive: true, force: true });
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
    expect(report.pending).toEqual([]);
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).resolves.toBeUndefined();
  });

  test("mixed-case snapshot tableName resolves via quote_ident round-trip", async () => {
    // PostgreSQL folds unquoted identifier case to lowercase (myWidget → mywidget)
    // in to_regclass, while the DDL via quoteIdent("kdriftMixed") → "kdriftMixed"
    // preserves case. tableExists must perform a quote_ident round trip;
    // otherwise every mixed-case entity table produces false-positive drift.
    await asRawClient(testDb.db).unsafe(`CREATE TABLE "kdriftMixed" ("id" text PRIMARY KEY)`);
    expect(await tableExists(testDb.db, "kdriftMixed")).toBe(true);
    // The lowercase variant MUST NOT match — the round trip preserves case.
    expect(await tableExists(testDb.db, "kdriftmixed")).toBe(false);

    writeMigration("0001_init.sql", `CREATE TABLE "kdriftMixed" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdriftMixed"]);
    await asRawClient(testDb.db).unsafe(`DROP TABLE "kdriftMixed"`);
    await runMigrationsFromDir(testDb.db, dir);
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.missingTables).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test("baseline marks migrations applied without running SQL", async () => {
    // The table already exists (as in an adopted production database), so the migration must not be
    // applied.
    await asRawClient(testDb.db).unsafe(`CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY)`);
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);

    const result = await baselineMigrations(testDb.db, loadMigrationsFromDir(dir));
    expect(result.marked).toEqual(["0001_init"]);

    // Drift-free afterwards (applied via baseline and the table exists); re-baselining is a no-op.
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
    const again = await baselineMigrations(testDb.db, loadMigrationsFromDir(dir));
    expect(again.marked).toEqual([]);
    expect(again.alreadyTracked).toEqual(["0001_init"]);
  });
});

describe("kumiko-drift end-to-end (generate → apply → gate)", () => {
  test("generate from entity metas → apply → gate ok (the local-verify proof)", async () => {
    const entity = createEntity({
      table: "kdrift_gen",
      fields: {
        name: createTextField({ personal: false, reason: "test_fixture", required: true }),
      },
    });
    const meta = deriveEntityTableMeta("kdriftGen", entity);
    const result = generateMigration({
      metas: [meta],
      prevSnapshot: null,
      name: "init",
      sequenceNumber: 1,
    });

    writeFileSync(join(dir, result.filename), result.sqlContent);
    writeSnapshotJson(join(dir, ".snapshot.json"), result.snapshot);

    await runMigrationsFromDir(testDb.db, dir);
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
  });

  test("prod adoption via commented-out SQL: apply is a recorded no-op, gate ok when tables pre-exist", async () => {
    // Production scenario: the table already exists (from the drizzle era). The migration file
    // is commented out, so apply creates nothing but records the entry in
    // _kumiko_migrations. The gate sees an applied migration and an existing table,
    // so boot proceeds.
    await asRawClient(testDb.db).unsafe(`CREATE TABLE "kdrift_gen" ("id" text PRIMARY KEY)`);
    writeMigration(
      "0001_init.sql",
      `-- CREATE TABLE "kdrift_gen" ("id" text PRIMARY KEY);  -- commented for prod adoption`,
    );
    writeSnapshot(["kdrift_gen"]);

    const applyResult = await runMigrationsFromDir(testDb.db, dir);
    expect(applyResult.applied).toEqual(["0001_init"]); // recorded trotz no-op-SQL

    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
  });
});
