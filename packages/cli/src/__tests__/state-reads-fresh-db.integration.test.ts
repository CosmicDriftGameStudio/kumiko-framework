// `project list|status`, `consumer list|status` and `ops seed:status` only read:
// on a database without their state tables they must report "nothing yet"
// and must not create the table.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { tableExists } from "@cosmicdrift/kumiko-framework/db";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { runCli } from "../index";

const PROJECTION_NAME = "clistatetest:projection:items-per-group";
const SSE_CONSUMER = "system:consumer:sse-broadcast";
const TMP_PARENT = join(import.meta.dir, ".tmp-state-reads");

const CONFIG_SOURCE = `import { table, uuid } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";

const entity = createEntity({
  table: "read_clistate_items",
  fields: { name: createTextField({ personal: false, reason: "test_fixture", required: true }) },
});
const projectionTable = table("read_clistate_counts", { id: uuid("id").primaryKey() });

export default {
  features: [
    defineFeature("clistatetest", (r) => {
      r.entity({ name: "clistate-item", ...entity });
      r.projection({
        name: "items-per-group",
        source: "clistate-item",
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

let testDb: TestDb;
let appDir: string;
const previousDatabaseUrl = process.env["DATABASE_URL"];

beforeAll(async () => {
  testDb = await createTestDb();
  // Config must resolve @cosmicdrift/* from this package's node_modules, so it lives next to the tests.
  mkdirSync(TMP_PARENT, { recursive: true });
  appDir = mkdtempSync(join(TMP_PARENT, "state-reads-"));
  writeFileSync(join(appDir, "kumiko.config.ts"), CONFIG_SOURCE);

  const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
  url.pathname = `/${testDb.dbName}`;
  process.env["DATABASE_URL"] = url.toString();
});

afterAll(async () => {
  if (previousDatabaseUrl === undefined) delete process.env["DATABASE_URL"];
  else process.env["DATABASE_URL"] = previousDatabaseUrl;
  rmSync(TMP_PARENT, { recursive: true, force: true });
  await testDb.cleanup();
});

describe("kumiko project / consumer reads on a fresh database", () => {
  test("project list on a fresh database reports no state and creates no table", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["project", "list"], cwd: appDir, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("kumiko_projections does not exist");
    expect(await tableExists(testDb.db, "public.kumiko_projections")).toBe(false);
  });

  test("project status of a registered projection prints never-rebuilt without creating the table", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["project", "status", PROJECTION_NAME], cwd: appDir, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain(`${PROJECTION_NAME}: never-rebuilt`);
    expect(await tableExists(testDb.db, "public.kumiko_projections")).toBe(false);
  });

  test("consumer list on a fresh database reports no state and creates no table", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["consumer", "list"], cwd: appDir, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("kumiko_event_consumers does not exist");
    expect(await tableExists(testDb.db, "public.kumiko_event_consumers")).toBe(false);
  });

  test("consumer status of a registered consumer prints never-run without creating the table", async () => {
    const { out, logs } = capture();
    const code = await runCli({ argv: ["consumer", "status", SSE_CONSUMER], cwd: appDir, out });
    expect(code).toBe(0);
    expect(logs.join("\n")).toContain("never-run");
    expect(await tableExists(testDb.db, "public.kumiko_event_consumers")).toBe(false);
  });

  test("consumer disable creates the state table", async () => {
    const { out } = capture();
    await runCli({ argv: ["consumer", "disable", SSE_CONSUMER], cwd: appDir, out });
    expect(await tableExists(testDb.db, "public.kumiko_event_consumers")).toBe(true);
  });
});

describe("kumiko ops seed:status (real DB)", () => {
  test("lists a pending seed without creating kumiko_es_operations", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "kumiko-seed-status-"));
    try {
      mkdirSync(join(cwd, "seeds"));
      writeFileSync(join(cwd, "seeds", "2026-01-01-a.ts"), "export default {};\n");
      const { out, logs } = capture();
      const code = await runCli({ argv: ["ops", "seed:status"], cwd, out });
      expect(code).toBe(0);
      expect(logs.join("\n")).toContain("2026-01-01-a (pending)");
      expect(await tableExists(testDb.db, "public.kumiko_es_operations")).toBe(false);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
