// Integration test for the `runSchemaCli` `status` subcommand.
// Previously, `try/catch` swallowed every error (connection, permission, and query)
// and reported everything as "pending".
// Now, a missing tracking table means 0 applied (no error); real errors are
// reported as a CLI error with exit 1.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../db/__tests__/query/bun-test-db.ts";
import { asRawClient } from "../db/query.ts";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli.ts";
import { ensureTemporalPolyfill } from "../time/polyfill.ts";

let testDb: BunTestDb;
let appDir: string;
let testUrl: string;
let prevDbUrl: string | undefined;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL not set — required for this test file");
  testUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
});

afterAll(async () => {
  await testDb.cleanup();
});

beforeEach(async () => {
  // runSchemaCli resolves appCwd/kumiko/migrations — writeMigration() creates the
  // subdirectory as needed. Tests that check the "directory missing" path do not
  // call writeMigration.
  appDir = mkdtempSync(join(tmpdir(), "kumiko-cli-"));
  prevDbUrl = process.env["DATABASE_URL"];
  await asRawClient(testDb.db).unsafe(`DROP TABLE IF EXISTS "_kumiko_migrations"`);
});

afterEach(() => {
  rmSync(appDir, { recursive: true, force: true });
  if (prevDbUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = prevDbUrl;
});

function writeMigration(file: string, sql: string): void {
  const migDir = join(appDir, "kumiko", "migrations");
  mkdirSync(migDir, { recursive: true });
  writeFileSync(join(migDir, file), sql);
}

function captureOut(): { out: SchemaCliOut; lines: string[] } {
  const lines: string[] = [];
  return {
    out: { log: (l: string) => lines.push(l), err: (l: string) => lines.push(`ERR ${l}`) },
    lines,
  };
}

describe("runSchemaCli status", () => {
  test("fresh DB without _kumiko_migrations → 0 applied (no throw)", async () => {
    process.env["DATABASE_URL"] = testUrl;
    writeMigration("0001_init.sql", `SELECT 1;`);
    const { out, lines } = captureOut();
    const code = await runSchemaCli(["status"], appDir, out);
    // Exit 1 = pending-drift erkannt (1 Migration lokal, 0 applied); status gated CI non-zero.
    expect(code).toBe(1);
    const joined = lines.join("\n");
    expect(joined).toContain("0 applied");
    expect(joined).toContain("1 pending");
    // No ERR prefix → no silent swallowing of a real error.
    expect(joined).not.toContain("ERR ");
  });

  test("missing kumiko/migrations dir → no-op exit 0", async () => {
    // Confirms the symmetric case: no directory means nothing to report, with no crash.
    process.env["DATABASE_URL"] = testUrl;
    const { out, lines } = captureOut();
    const code = await runSchemaCli(["status"], appDir, out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("No kumiko/migrations/");
  });

  test("unreachable DB → reports the connection error with exit 1 (no silent '0 applied')", async () => {
    // A connection failure must surface as an error, never as "0 applied"; it is
    // reported as a CLI error instead of an uncaught stacktrace. Nothing on
    // POSIX binds port 1, so the connect is refused.
    process.env["DATABASE_URL"] = "postgresql://nobody:nope@127.0.0.1:1/__kumiko_unreachable__";
    writeMigration("0001_init.sql", `SELECT 1;`);
    const { out, lines } = captureOut();
    const code = await runSchemaCli(["status"], appDir, out);
    expect(code).toBe(1);
    const joined = lines.join("\n");
    expect(joined).toContain("ERR   ✗ schema status failed:");
    expect(joined).not.toContain("applied");
    expect(joined).not.toContain("nobody:nope@");
  });
});
