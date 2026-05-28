// Integration-Test für `runSchemaCli` `status`-Subcommand.
// Regression für review #155 finding 4: vorher schluckte `try/catch` jeden
// Fehler (Connection-, Permission-, Query-) und reportete alles als "pending".
// Jetzt: tracking-table fehlt → 0 applied (kein Fehler), echte Fehler werden
// propagiert. Konsistent zum detectKumikoDrift-Pattern.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../bun-db/__tests__/bun-test-db";
import { asRawClient } from "../db/query";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli";
import { ensureTemporalPolyfill } from "../time/polyfill";

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
  // runSchemaCli resolves appCwd/kumiko/migrations — writeMigration() legt das
  // subdir bei Bedarf an. Tests, die den "Dir fehlt"-Pfad prüfen, rufen
  // writeMigration nicht auf.
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
    expect(code).toBe(0);
    const joined = lines.join("\n");
    expect(joined).toContain("0 applied");
    expect(joined).toContain("1 pending");
    // Kein ERR-Prefix → kein silent-swallow eines echten Fehlers.
    expect(joined).not.toContain("ERR ");
  });

  test("missing kumiko/migrations dir → no-op exit 0", async () => {
    // Bestätigt symmetrisch: kein Verzeichnis = nichts zu reporten, kein Crash.
    process.env["DATABASE_URL"] = testUrl;
    const { out, lines } = captureOut();
    const code = await runSchemaCli(["status"], appDir, out);
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("Kein kumiko/migrations/");
  });

  test("unreachable DB → propagates connection error (no silent '0 applied')", async () => {
    // Der gefixte Pfad MUSS connection-failures propagieren — vor dem Fix hat
    // `try { applied = new Set(...) } catch { applied = new Set() }` das zu
    // "0 applied" verfälscht und den Operator in die Irre geführt.
    // Port 1 wird auf POSIX-Systemen für nichts gebunden → connect refused.
    process.env["DATABASE_URL"] = "postgresql://nobody:nope@127.0.0.1:1/__kumiko_unreachable__";
    writeMigration("0001_init.sql", `SELECT 1;`);
    const { out } = captureOut();
    await expect(runSchemaCli(["status"], appDir, out)).rejects.toBeDefined();
  });
});
