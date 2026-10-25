// Migration-safety test: `ALTER TABLE … SET NOT NULL` fails when
// the column contains NULL values before the migration.
//
// Background: The A-Fix (required → notNull in fieldToColumns) generates
// a drift-fix migration for existing apps with `SET NOT NULL` on every
// required field. This is safe for FRESH DBs (with no data), but dangerous
// for production DBs where historical NULL values may have entered—the
// migration fails during apply with:
//
//   ERROR: column "<name>" of relation "<table>" contains null values
//   STATE: 23502 (not_null_violation)
//
// This test simulates that scenario. It creates a table with a nullable
// `key`, inserts a row with NULL, then attempts SET NOT NULL and expects
// the Postgres error. Operations note: before deploying such a migration,
// run a sanity query for NULL counts in the affected columns, or drop the
// DB if its state is only demo data.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { asRawClient } from "../../db/query.ts";
import { ensureTemporalPolyfill } from "../../time/polyfill.ts";
import { extractPgError } from "../pg-error.ts";
import { type BunTestDb, createTestDb } from "./query/bun-test-db.ts";

let testDb: BunTestDb;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS migration_safety_test`);
});

describe("ALTER TABLE SET NOT NULL — Daten-Sicherheits-Verhalten", () => {
  test("SET NOT NULL fails when the column contains rows with NULL values", async () => {
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    // Inserts a NULL row to simulate production state before the drift fix.
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES (NULL)`);

    let caught: unknown;
    try {
      await asRawClient(testDb.db).unsafe(
        `ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`,
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(extractPgError(caught)?.code).toBe("23502");
  });

  test("SET NOT NULL runs cleanly when all rows have values", async () => {
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES ('foo')`);
    await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES ('bar')`);

    // Must complete without throwing.
    await asRawClient(testDb.db).unsafe(
      `ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`,
    );

    // Verifies that future NULL inserts are now blocked.
    let caught: unknown;
    try {
      await asRawClient(testDb.db).unsafe(`INSERT INTO migration_safety_test (key) VALUES (NULL)`);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
  });

  test("SET NOT NULL on an empty table is trivially safe", async () => {
    // Newly created with no rows—the case in which `migrate apply` runs after
    // a DB drop. This path must ALWAYS succeed; otherwise every Greenfield
    // deployment would fail.
    await asRawClient(testDb.db).unsafe(`
      CREATE TABLE migration_safety_test (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key text
      )
    `);
    await asRawClient(testDb.db).unsafe(
      `ALTER TABLE migration_safety_test ALTER COLUMN key SET NOT NULL`,
    );

    // Verifies that information_schema now reports the column as NOT NULL.
    const rows = await asRawClient(testDb.db).unsafe<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns WHERE table_name = 'migration_safety_test' AND column_name = 'key'`,
    );
    expect(rows[0]?.is_nullable).toBe("NO");
  });
});
