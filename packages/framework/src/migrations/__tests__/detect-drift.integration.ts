// Integration-Test für detectDrift — vergleicht Journal vs.
// __drizzle_migrations und expected-Tables vs. Reality. Production-
// Behavior: assertSchemaCurrent ist der Boot-Gate, jeder False-Positive
// hier blockiert Container-Starts; jeder False-Negative lässt
// Schema-Drift unentdeckt durch.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import { createTestDb, type TestDb } from "../../stack";
import { detectDrift } from "../schema-drift";

let testDb: TestDb;
let migrationsDir: string;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(() => {
  migrationsDir = mkdtempSync(join(tmpdir(), "kumiko-drift-"));
  mkdirSync(join(migrationsDir, "meta"), { recursive: true });
});

afterEach(() => {
  rmSync(migrationsDir, { recursive: true, force: true });
});

function writeJournal(entries: { idx: number; tag: string }[]): void {
  const journal = {
    version: "7",
    dialect: "postgresql",
    entries: entries.map((e) => ({
      idx: e.idx,
      version: "7",
      when: 1700000000000 + e.idx,
      tag: e.tag,
      breakpoints: true,
    })),
  };
  writeFileSync(join(migrationsDir, "meta/_journal.json"), JSON.stringify(journal));
}

function writeSnapshot(idx: number, tableNames: string[]): void {
  const tables: Record<string, unknown> = {};
  for (const name of tableNames) {
    tables[`public.${name}`] = {
      schema: "",
      name,
      columns: {
        id: { name: "id", type: "uuid", primaryKey: true, notNull: true },
      },
    };
  }
  writeFileSync(
    join(migrationsDir, "meta", `${String(idx).padStart(4, "0")}_snapshot.json`),
    JSON.stringify({ tables }),
  );
}

async function ensureDrizzleMigrationsTable(): Promise<void> {
  await testDb.db.execute(sql`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await testDb.db.execute(sql`
    CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
      id serial PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);
}

async function dropDrizzleMigrationsTable(): Promise<void> {
  await testDb.db.execute(sql`DROP TABLE IF EXISTS drizzle.__drizzle_migrations`);
}

async function insertAppliedMigration(hash: string): Promise<void> {
  await testDb.db.execute(
    sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${hash}, ${Date.now()})`,
  );
}

describe("detectDrift", () => {
  beforeEach(async () => {
    await dropDrizzleMigrationsTable();
    // Cleanup test tables that might still exist from earlier runs
    await testDb.db.execute(sql`DROP TABLE IF EXISTS drift_test_users`);
    await testDb.db.execute(sql`DROP TABLE IF EXISTS drift_test_orders`);
  });

  test("frische DB ohne __drizzle_migrations + 1 Migration im Journal → 1 pending + table missing", async () => {
    writeJournal([{ idx: 0, tag: "0000_init" }]);
    writeSnapshot(0, ["drift_test_users"]);

    const report = await detectDrift(testDb.db, migrationsDir);
    expect(report.ok).toBe(false);
    expect(report.pendingMigrations).toHaveLength(1);
    expect(report.pendingMigrations[0]?.tag).toBe("0000_init");
    expect(report.missingTables).toEqual(["drift_test_users"]);
  });

  test("alle Migrations applied + alle Tabellen existieren → ok", async () => {
    writeJournal([{ idx: 0, tag: "0000_init" }]);
    writeSnapshot(0, ["drift_test_users"]);
    await testDb.db.execute(sql`CREATE TABLE drift_test_users (id uuid PRIMARY KEY)`);
    await ensureDrizzleMigrationsTable();
    await insertAppliedMigration("hash-0000");

    const report = await detectDrift(testDb.db, migrationsDir);
    expect(report.ok).toBe(true);
    expect(report.pendingMigrations).toHaveLength(0);
    expect(report.missingTables).toHaveLength(0);
  });

  test("partial applied: Journal hat 2, applied hat 1 → 1 pending", async () => {
    writeJournal([
      { idx: 0, tag: "0000_init" },
      { idx: 1, tag: "0001_add_orders" },
    ]);
    writeSnapshot(1, ["drift_test_users", "drift_test_orders"]);
    await testDb.db.execute(sql`CREATE TABLE drift_test_users (id uuid PRIMARY KEY)`);
    await testDb.db.execute(sql`CREATE TABLE drift_test_orders (id uuid PRIMARY KEY)`);
    await ensureDrizzleMigrationsTable();
    await insertAppliedMigration("hash-0000"); // nur eine applied

    const report = await detectDrift(testDb.db, migrationsDir);
    expect(report.ok).toBe(false);
    expect(report.pendingMigrations).toHaveLength(1);
    expect(report.pendingMigrations[0]?.tag).toBe("0001_add_orders");
    expect(report.missingTables).toHaveLength(0);
  });

  test("alle Migrations applied aber Tabelle fehlt manuell → drift", async () => {
    writeJournal([{ idx: 0, tag: "0000_init" }]);
    writeSnapshot(0, ["drift_test_users", "drift_test_orders"]);
    await testDb.db.execute(sql`CREATE TABLE drift_test_users (id uuid PRIMARY KEY)`);
    // drift_test_orders bewusst NICHT angelegt (simuliert manuellen DROP)
    await ensureDrizzleMigrationsTable();
    await insertAppliedMigration("hash-0000");

    const report = await detectDrift(testDb.db, migrationsDir);
    expect(report.ok).toBe(false);
    expect(report.pendingMigrations).toHaveLength(0);
    expect(report.missingTables).toEqual(["drift_test_orders"]);
  });

  test("public.__drizzle_migrations Fallback (Pre-0.20-Drizzle)", async () => {
    writeJournal([{ idx: 0, tag: "0000_init" }]);
    writeSnapshot(0, ["drift_test_users"]);
    await testDb.db.execute(sql`CREATE TABLE drift_test_users (id uuid PRIMARY KEY)`);
    // Legacy: Tabelle in public-Schema statt drizzle-Schema
    await dropDrizzleMigrationsTable();
    await testDb.db.execute(sql`
      CREATE TABLE public.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `);
    try {
      await testDb.db.execute(
        sql`INSERT INTO public.__drizzle_migrations (hash, created_at) VALUES ('hash-0000', ${Date.now()})`,
      );
      const report = await detectDrift(testDb.db, migrationsDir);
      expect(report.ok).toBe(true);
    } finally {
      await testDb.db.execute(sql`DROP TABLE public.__drizzle_migrations`);
    }
  });
});
