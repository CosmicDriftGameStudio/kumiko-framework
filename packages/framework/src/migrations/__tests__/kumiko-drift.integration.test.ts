// Integration-Test für das drizzle-freie Boot-Gate (detectKumikoDrift /
// assertKumikoSchemaCurrent). Production-Behavior: dieses Gate blockiert
// Container-Starts — jeder False-Positive blockt Boot, jeder False-Negative
// lässt Schema-Drift durch.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../../bun-db/__tests__/bun-test-db";
import { buildEntityTableMeta } from "../../db/entity-table-meta";
import { generateMigration, writeSnapshotJson } from "../../db/migrate-generator";
import {
  baselineMigrations,
  loadMigrationsFromDir,
  runMigrationsFromDir,
} from "../../db/migrate-runner";
import { asRawClient } from "../../db/query";
import { tableExists } from "../../db/schema-inspection";
import { createEntity, createTextField } from "../../engine";
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

    // File nachträglich editieren (anderer Inhalt → andere checksum).
    writeMigration(
      "0001_init.sql",
      `CREATE TABLE "kdrift_widget" ("id" text PRIMARY KEY, "x" int);`,
    );
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

  test("missing migrations dir → ok (no migrations to validate)", async () => {
    // Regression für review #155 finding 1: existing-App-Upgrade ohne
    // ./kumiko/migrations darf nicht roh ENOENT werfen (würde sonst plain
    // Error statt SchemaDriftError → kein Remediation-Hint im Boot-Log).
    rmSync(dir, { recursive: true, force: true });
    const report = await detectKumikoDrift(testDb.db, dir);
    expect(report.ok).toBe(true);
    expect(report.pending).toEqual([]);
    await expect(assertKumikoSchemaCurrent(testDb.db, dir)).resolves.toBeUndefined();
  });

  test("mixed-case snapshot tableName resolves via quote_ident round-trip", async () => {
    // Regression für review #155 finding 3: postgres folded unquoted
    // identifier case-insensitiv (myWidget → mywidget) in to_regclass, während
    // die DDL via quoteIdent("kdriftMixed") → "kdriftMixed" case-preserved
    // schreibt. tableExists muss quote_ident-Round-trip machen, sonst False-
    // positive-Drift bei jeder mixed-case Entity-Tabelle.
    await asRawClient(testDb.db).unsafe(`CREATE TABLE "kdriftMixed" ("id" text PRIMARY KEY)`);
    expect(await tableExists(testDb.db, "kdriftMixed")).toBe(true);
    // Lowercase-Variante DARF nicht matchen — Round-trip preserved case.
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

describe("kumiko-drift end-to-end (generate → apply → gate)", () => {
  test("generate from entity metas → apply → gate ok (the local-verify proof)", async () => {
    const entity = createEntity({
      table: "kdrift_gen",
      fields: { name: createTextField({ required: true }) },
    });
    const meta = buildEntityTableMeta("kdriftGen", entity);
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
    // Prod-Szenario: Tabelle existiert schon (drizzle-Ära). Das Migration-File
    // ist auskommentiert → apply legt nichts an, RECORDED aber den Eintrag in
    // _kumiko_migrations. Gate: applied ✓ + Tabelle existiert ✓ → Boot läuft.
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
