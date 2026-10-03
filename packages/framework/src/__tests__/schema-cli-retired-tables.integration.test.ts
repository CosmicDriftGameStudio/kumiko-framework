// A framework table the release notes declared dispensable
// (read_job_runs) used to live on forever behind a commented DESTRUCTIVE drop.
// `generate` now writes the executable drop, `status` flags the leftover.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../bun-db/__tests__/bun-test-db.js";
import { createDbConnection } from "../db/connection.js";
import { tableExists } from "../db/index.js";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli.js";
import { ensureTemporalPolyfill } from "../time/polyfill.js";

function captureOut(): { out: SchemaCliOut; log: string[] } {
  const log: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => log.push(`ERR ${l}`) }, log };
}

const SCHEMA_WITH_KEPT_TABLE = `export const ENTITY_METAS = [
  { tableName: "tbl_retired_keep", source: "unmanaged", indexes: [],
    columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }] },
];
`;

const LEGACY_MIGRATION = `CREATE TABLE IF NOT EXISTS "read_job_runs" ("id" uuid PRIMARY KEY);
-- DESTRUCTIVE: DROP TABLE IF EXISTS "read_job_runs";  -- uncomment + ensure backup
`;

describe("retired framework tables (fw#3531)", () => {
  let testDb: BunTestDb;
  let prevDbUrl: string | undefined;
  let dbUrl: string;
  let appCwd: string;

  beforeAll(async () => {
    await ensureTemporalPolyfill();
    testDb = await createTestDb();
    const baseUrl = process.env["TEST_DATABASE_URL"];
    if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
    dbUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = dbUrl;
    appCwd = join(tmpdir(), `kumiko-retired-${process.pid}-${Date.now()}`);
    mkdirSync(join(appCwd, "kumiko"), { recursive: true });
    writeFileSync(join(appCwd, "kumiko/schema.ts"), SCHEMA_WITH_KEPT_TABLE);
  });

  afterAll(async () => {
    rmSync(appCwd, { recursive: true, force: true });
    if (prevDbUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = prevDbUrl;
    await testDb?.cleanup();
  });

  async function liveTableExists(name: string): Promise<boolean> {
    const { db, close } = createDbConnection(dbUrl);
    try {
      return await tableExists(db, name);
    } finally {
      await close();
    }
  }

  test("status reports the leftover, generate drops it, apply removes it", async () => {
    expect((await runSchemaCli(["generate", "init"], appCwd, captureOut().out)) as number).toBe(0);
    const migrationsDir = join(appCwd, "kumiko/migrations");
    writeFileSync(join(migrationsDir, "0002_legacy_job_runs.sql"), LEGACY_MIGRATION);
    expect(await runSchemaCli(["apply"], appCwd, captureOut().out)).toBe(0);
    expect(await liveTableExists("read_job_runs")).toBe(true);

    const before = captureOut();
    await runSchemaCli(["status"], appCwd, before.out);
    const beforeText = before.log.join("\n");
    expect(beforeText).toContain("read_job_runs");
    expect(beforeText).toContain("retired framework table");

    const generate = captureOut();
    expect(await runSchemaCli(["generate", "retire_job_runs"], appCwd, generate.out)).toBe(0);
    const retireFile = readdirSync(migrationsDir).find((f) => f.endsWith("retire_job_runs.sql"));
    expect(retireFile).toBeDefined();
    expect(readFileSync(join(migrationsDir, retireFile ?? ""), "utf8")).toMatch(
      /^DROP TABLE IF EXISTS "read_job_runs";$/m,
    );

    expect(await runSchemaCli(["apply"], appCwd, captureOut().out)).toBe(0);
    expect(await liveTableExists("read_job_runs")).toBe(false);
    expect(await liveTableExists("tbl_retired_keep")).toBe(true);

    const after = captureOut();
    expect(await runSchemaCli(["status"], appCwd, after.out)).toBe(0);
    expect(after.log.join("\n")).not.toContain("retired framework table");

    const second = captureOut();
    await runSchemaCli(["generate", "again"], appCwd, second.out);
    expect(second.log.join("\n")).toContain("No schema changes detected");
    expect(await runSchemaCli(["validate"], appCwd, captureOut().out)).toBe(0);
  });
});
