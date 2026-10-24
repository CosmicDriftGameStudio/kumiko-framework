// Databases created before row-level security was on have kumiko_events & co. without policies:
// the create functions skip existing tables, so only the re-apply path can heal them.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applicationRoleUrlOf, createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { assertRowLevelSecurityBootState } from "../../db/index.ts";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { asRawClient } from "../../db/query.ts";
import { runApplyCommand } from "../apply-command.ts";
import type { SchemaCliContext } from "../shared.ts";
import { runValidateCommand } from "../validate-command.ts";

const TENANT_FRAMEWORK_TABLES = [
  "kumiko_events",
  "kumiko_archived_streams",
  "kumiko_snapshots",
] as const;
const ALL_KNOWN = { has: () => true };

let testDb: TestDb;
let workDir: string;
let ctx: SchemaCliContext;
let lines: string[];
let baseUrl: string;
let previousDatabaseUrl: string | undefined;

const stateOf = (table: string) => readRowLevelSecurityState(testDb.db, "public", table);

async function stripRowLevelSecurity(): Promise<void> {
  const raw = asRawClient(testDb.db);
  for (const table of TENANT_FRAMEWORK_TABLES) {
    await raw.unsafe(`DROP POLICY IF EXISTS kumiko_tenant_isolation ON "${table}"`);
    await raw.unsafe(`DROP POLICY IF EXISTS kumiko_system_tenant_read ON "${table}"`);
    await raw.unsafe(`ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`);
    await raw.unsafe(`ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`);
  }
}

beforeAll(async () => {
  testDb = await createTestDb({ applicationRole: true });
  workDir = mkdtempSync(join(tmpdir(), "kumiko-rls-heal-"));
  mkdirSync(join(workDir, "migrations"));
  writeFileSync(
    join(workDir, "schema.ts"),
    'export const ENTITY_METAS = [];\nexport const ROW_LEVEL_SECURITY = "on";\n',
  );
  lines = [];
  const sink = (line: string) => void lines.push(line);
  ctx = {
    argv: [],
    out: { log: sink, err: sink },
    options: {},
    schemaFile: join(workDir, "schema.ts"),
    migrationsDir: join(workDir, "migrations"),
  };
  previousDatabaseUrl = process.env["DATABASE_URL"];
  const configuredUrl = process.env["TEST_DATABASE_URL"];
  if (!configuredUrl) throw new Error("TEST_DATABASE_URL is required");
  baseUrl = configuredUrl;
  process.env["DATABASE_URL"] = applicationRoleUrlOf(baseUrl, testDb.dbName);
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  rmSync(workDir, { recursive: true, force: true });
  await testDb.cleanup();
});

describe("framework tables created before row-level security was on", () => {
  test("schema validate reports the missing policies, schema apply heals them, a second apply changes nothing", async () => {
    await stripRowLevelSecurity();
    await expect(assertRowLevelSecurityBootState(testDb.db, "on", ALL_KNOWN)).rejects.toThrow(
      /kumiko_events/,
    );

    lines = [];
    expect(await runValidateCommand(ctx)).toBe(1);
    const reported = lines.filter((line) => line.includes("row-level security")).join("\n");
    expect(reported).toContain("✗ row-level security");
    expect(reported).toContain("kumiko schema apply");
    for (const table of TENANT_FRAMEWORK_TABLES) expect(reported).toContain(table);

    expect(await runApplyCommand(ctx)).toBe(0);
    for (const table of TENANT_FRAMEWORK_TABLES) {
      expect(await stateOf(table)).toMatchObject({ enabled: true, forced: true });
    }
    await assertRowLevelSecurityBootState(testDb.db, "on", ALL_KNOWN);

    lines = [];
    expect(await runValidateCommand(ctx)).toBe(0);
    expect(lines.join("\n")).toContain("✓ row-level security");

    expect(await runApplyCommand(ctx)).toBe(0);
    await assertRowLevelSecurityBootState(testDb.db, "on", ALL_KNOWN);
  });

  test("validate does not check the connected role: a superuser connection on protected tables is green", async () => {
    process.env["DATABASE_URL"] = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
    lines = [];
    expect(await runValidateCommand(ctx)).toBe(0);
    expect(lines.join("\n")).toContain("✓ row-level security");
  });

  test("validate on a database without any table is green", async () => {
    process.env["DATABASE_URL"] = baseUrl.replace(/\/[^/]+$/, "/postgres");
    lines = [];
    expect(await runValidateCommand(ctx)).toBe(0);
  });
});
