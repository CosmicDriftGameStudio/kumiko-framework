// Production-Behavior von `kumiko schema apply` (runSchemaApply): der
// migrate-initContainer ruft das gegen eine frische CNPG-DB. Der riskante,
// neue Teil gegenüber dem alten per-App-Boilerplate ist der Greenfield-
// Bootstrap — Infra-Tabellen (event-store + pipeline-state) MÜSSEN vor den
// App-Migrations idempotent angelegt werden, sonst bricht eine leere DB an
// `relation "kumiko_events" does not exist`. Dieser Test fährt den echten
// Pfad gegen eine leere DB + den idempotenten Re-Run.

import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  asRawClient,
  createDbConnection,
  type DbConnection,
  tableExists,
} from "@cosmicdrift/kumiko-framework/db";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-framework/stack";
import { runSchemaApply } from "../schema-apply";

let testDb: TestDb;
let conn: { readonly db: DbConnection; readonly close: () => Promise<void> };
let appCwd: string;
let migDir: string;
const savedDbUrl = process.env["DATABASE_URL"];

const APPLY = { features: [], includeBundled: false } as const;

beforeAll(async () => {
  const base = process.env["TEST_DATABASE_URL"];
  if (!base) throw new Error("TEST_DATABASE_URL required for schema-apply integration test");

  testDb = await createTestDb();
  const testUrl = base.replace(/\/[^/]+$/, `/${testDb.dbName}`);
  process.env["DATABASE_URL"] = testUrl;
  conn = createDbConnection(testUrl);

  // Greenfield erzwingen: createTestDb legt kumiko_events bereits an —
  // wegdroppen, damit runSchemaApply den Infra-Bootstrap echt durchläuft.
  const raw = asRawClient(conn.db);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_events" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_event_consumers" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "kumiko_projections" CASCADE`);
  await raw.unsafe(`DROP TABLE IF EXISTS "_kumiko_migrations" CASCADE`);

  appCwd = mkdtempSync(join(tmpdir(), "kumiko-schema-apply-"));
  migDir = join(appCwd, "kumiko", "migrations");
  mkdirSync(migDir, { recursive: true });
  writeFileSync(
    join(migDir, "0001_init.sql"),
    `CREATE TABLE "read_thing" ("id" text PRIMARY KEY);`,
  );
});

afterAll(async () => {
  await conn?.close();
  await testDb?.cleanup();
  if (appCwd) rmSync(appCwd, { recursive: true, force: true });
  if (savedDbUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = savedDbUrl;
});

describe("runSchemaApply", () => {
  test("Greenfield: leere DB → Infra-Tabellen + App-Migration appliziert → 0", async () => {
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);

    expect(await tableExists(conn.db, "public.kumiko_events")).toBe(true);
    expect(await tableExists(conn.db, "public.kumiko_event_consumers")).toBe(true);
    expect(await tableExists(conn.db, "public.kumiko_projections")).toBe(true);
    expect(await tableExists(conn.db, "public.read_thing")).toBe(true);
  });

  test("Re-Run auf Bestands-DB ist idempotent → 0 (Infra no-op, Migrations skipped)", async () => {
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);
    expect(await tableExists(conn.db, "public.read_thing")).toBe(true);
  });

  test("rebuild-Marker für nicht-registrierte Tabelle → kein Crash, 0, aber laut warnen (522/3)", async () => {
    writeFileSync(
      join(migDir, "0002_more.sql"),
      `CREATE TABLE "read_more" ("id" text PRIMARY KEY);`,
    );
    writeFileSync(
      join(migDir, "0002_more.rebuild.json"),
      JSON.stringify({ version: 1, tables: ["read_more"] }),
    );

    const warn = spyOn(console, "warn").mockImplementation(() => {});
    expect(await runSchemaApply({ ...APPLY, appCwd })).toBe(0);
    expect(await tableExists(conn.db, "public.read_more")).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Table "read_more"'));
    warn.mockRestore();
  });
});
