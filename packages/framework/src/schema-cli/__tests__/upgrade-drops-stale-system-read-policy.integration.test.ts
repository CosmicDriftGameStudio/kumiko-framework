// Upgrade path of the systemRowsReadable marker: a database whose snapshot and catalog still carry
// kumiko_system_tenant_read for a table that is no longer marked must lose the policy through
// generate + apply, not only through the boot check's complaint.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { readRowLevelSecurityState } from "../../db/queries/rls-catalog.ts";
import { runSchemaCli } from "../../schema-cli.ts";
import type { SchemaCliOut } from "../shared.ts";

const TABLE = "store_upgrade_items";
const SYSTEM_READ_POLICY = "kumiko_system_tenant_read";
const ISOLATION_POLICY = "kumiko_tenant_isolation";

function schemaSource(systemRowsReadable: boolean): string {
  return `export const ENTITY_METAS = [
  {
    tableName: "${TABLE}",
    source: "unmanaged",
    indexes: [],
    ${systemRowsReadable ? "systemRowsReadable: true," : ""}
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true, defaultSql: "gen_random_uuid()" },
      { name: "tenant_id", pgType: "uuid", notNull: true },
    ],
  },
];
export const ROW_LEVEL_SECURITY = "on";
`;
}

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

function freshAppDir(systemRowsReadable: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "kumiko-rls-upgrade-"));
  mkdirSync(join(dir, "kumiko"));
  writeFileSync(join(dir, "kumiko/schema.ts"), schemaSource(systemRowsReadable));
  return dir;
}

let testDb: TestDb;
let databaseUrl: string;
const appDirs: string[] = [];

beforeAll(async () => {
  testDb = await createTestDb();
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (!baseUrl) throw new Error("TEST_DATABASE_URL is required");
  databaseUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
});

afterAll(async () => {
  for (const dir of appDirs) rmSync(dir, { recursive: true, force: true });
  await testDb.cleanup();
});

async function policyNames(): Promise<string[]> {
  const state = await readRowLevelSecurityState(testDb.db, "public", TABLE);
  return (state?.policies ?? []).map((policy) => policy.name).sort();
}

describe("a table that stops being marked systemRowsReadable", () => {
  test("generate renders the DROP of the system read policy and apply removes it from the catalog", async () => {
    await withEnv({ DATABASE_URL: databaseUrl }, async () => {
      // schema.ts is imported once per path, so the unmarked schema lives in a second app dir that
      // inherits the migrations (and snapshot) of the first.
      const oldApp = freshAppDir(true);
      appDirs.push(oldApp);
      expect(await runSchemaCli(["generate", "init"], oldApp, captureOut().out)).toBe(0);
      expect(await runSchemaCli(["apply"], oldApp, captureOut().out)).toBe(0);
      expect(await policyNames()).toEqual([SYSTEM_READ_POLICY, ISOLATION_POLICY]);

      const newApp = freshAppDir(false);
      appDirs.push(newApp);
      cpSync(join(oldApp, "kumiko/migrations"), join(newApp, "kumiko/migrations"), {
        recursive: true,
      });
      expect(await runSchemaCli(["generate", "unmark"], newApp, captureOut().out)).toBe(0);
      const migrationFile = readdirSync(join(newApp, "kumiko/migrations")).find((file) =>
        file.endsWith("_unmark.sql"),
      );
      if (migrationFile === undefined) throw new Error("generate wrote no unmark migration");
      const migrationSql = readFileSync(join(newApp, "kumiko/migrations", migrationFile), "utf8");
      expect(migrationSql).toContain(`DROP POLICY IF EXISTS "${SYSTEM_READ_POLICY}" ON "${TABLE}"`);

      expect(await runSchemaCli(["apply"], newApp, captureOut().out)).toBe(0);
      expect(await policyNames()).toEqual([ISOLATION_POLICY]);
    });
  });
});
