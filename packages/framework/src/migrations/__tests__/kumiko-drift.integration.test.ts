// Integration-Test für das drizzle-freie Boot-Gate (detectKumikoDrift /
// assertKumikoSchemaCurrent). Production-Behavior: dieses Gate blockiert
// Container-Starts — jeder False-Positive blockt Boot, jeder False-Negative
// lässt Schema-Drift durch.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { baselineMigrations, loadMigrationsFromDir, runMigrationsFromDir } from "../../db/migrate-runner";
import { asRawClient } from "../../db/query";
import { ensureTemporalPolyfill } from "../../time/polyfill";
import { assertKumikoSchemaCurrent, detectKumikoDrift, SchemaDriftError } from "../kumiko-drift";

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
  // Isoliere: tracking-table + Test-Tabellen pro Test zurücksetzen.
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "_kumiko_migrations"`);
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "kdrift_widget"`);
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
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).rejects.toBeInstanceOf(SchemaDriftError);
  });

  test("applied migration edited afterwards → checksum mismatch", async () => {
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);
    await runMigrationsFromDir(testDb.db, dir);

    // File nachträglich editieren (anderer Inhalt → andere checksum).
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY, "x" int);`);
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.checksumMismatches.map((m) => m.id)).toEqual(["0001_init"]);
  });

  test("snapshot table missing in DB → missingTables", async () => {
    writeMigration("0001_init.sql", `SELECT 1;`); // applied, aber legt die Tabelle NICHT an
    writeSnapshot(["kdrift_widget"]);
    await runMigrationsFromDir(testDb.db, dir);

    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(false);
    expect(report.missingTables).toEqual(["kdrift_widget"]);
  });

  test("baseline marks migrations applied without running SQL", async () => {
    // Tabelle existiert schon (wie eine adoptierte Prod-DB), Migration NICHT applyen.
    await asRawClient(testDb.db).unsafe(`CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY)`);
    writeMigration("0001_init.sql", `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY);`);
    writeSnapshot(["kdrift_widget"]);

    const result = await baselineMigrations(testDb.db, loadMigrationsFromDir(dir));
    expect(result.marked).toEqual(["0001_init"]);

    // Danach drift-frei (applied via baseline, Tabelle existiert), und re-baseline ist no-op.
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
    const again = await baselineMigrations(testDb.db, loadMigrationsFromDir(dir));
    expect(again.marked).toEqual([]);
    expect(again.alreadyTracked).toEqual(["0001_init"]);
  });
});
