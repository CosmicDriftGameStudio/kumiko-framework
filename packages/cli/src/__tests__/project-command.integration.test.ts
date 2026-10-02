// `kumiko project list|status` print Temporal timestamps from the projection
// state table; this drives them against a real Postgres row with a rebuild time.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { createProjectionStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-framework/stack";
import { runCli } from "../index";

const PROJECTION_NAME = "cliprojtest:projection:items-per-group";

const CONFIG_SOURCE = `import { table, uuid } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const entity = createEntity({
  table: "read_cliproj_items",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const projectionTable = table("read_cliproj_counts", { id: uuid("id").primaryKey() });

export default {
  features: [
    defineFeature("cliprojtest", (r) => {
      r.entity("cliproj-item", entity);
      r.projection({
        name: "items-per-group",
        source: "cliproj-item",
        table: projectionTable,
        apply: {},
      });
    }),
  ],
};
`;

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  logs: string[];
} {
  const logs: string[] = [];
  return { logs, out: { log: (s) => logs.push(s), err: (s) => logs.push(s) } };
}

describe("kumiko project (real DB)", () => {
  let testDb: TestDb;
  let appDir: string;
  const previousDatabaseUrl = process.env["DATABASE_URL"];

  beforeAll(async () => {
    testDb = await createTestDb();
    await createProjectionStateTable(testDb.db);
    await asRawClient(testDb.db).unsafe(
      `INSERT INTO kumiko_projections (name, last_processed_event_id, status, last_rebuild_at)
       VALUES ($1, 7, 'idle', '2026-01-02T03:04:05.000Z')`,
      [PROJECTION_NAME],
    );
    // Config must resolve @cosmicdrift/* from this package's node_modules, so it lives next to the tests.
    const parent = join(import.meta.dir, ".tmp");
    mkdirSync(parent, { recursive: true });
    appDir = mkdtempSync(join(parent, "project-cmd-"));
    writeFileSync(join(appDir, "kumiko.config.ts"), CONFIG_SOURCE);

    const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
    url.pathname = `/${testDb.dbName}`;
    process.env["DATABASE_URL"] = url.toString();
  });

  afterAll(async () => {
    if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
    else process.env["DATABASE_URL"] = previousDatabaseUrl;
    rmSync(join(import.meta.dir, ".tmp"), { recursive: true, force: true });
    await testDb.cleanup();
  });

  test("list prints the ISO rebuild time instead of crashing", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["project", "list"], cwd: appDir, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("2026-01-02T03:04:05");
  });

  test("status prints the ISO rebuild time and updated-at", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["project", "status", PROJECTION_NAME], cwd: appDir, out });
    expect(code).toBe(0);
    const printed = logs.join("\n");
    expect(printed).toContain("last rebuild:  2026-01-02T03:04:05");
    expect(printed).toMatch(/updated at:\s+\d{4}-\d{2}-\d{2}T/);
  });
});
