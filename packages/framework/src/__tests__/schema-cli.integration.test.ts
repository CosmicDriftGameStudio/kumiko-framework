import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BunTestDb, createTestDb } from "../bun-db/__tests__/bun-test-db";
import { createDbConnection, tableExists } from "../db";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli";
import { ensureTemporalPolyfill } from "../time/polyfill";

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

function freshAppCwd(): string {
  const dir = join(
    tmpdir(),
    `kumiko-schema-cli-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(dir, { recursive: true });
  mkdirSync(join(dir, "kumiko"), { recursive: true });
  return dir;
}

function writeSchemaFile(appCwd: string, tableName: string, extraField?: string): void {
  const extra = extraField ? `, { name: "${extraField}", pgType: "text", notNull: false }` : "";
  const content = `export const ENTITY_METAS = [
  {
    tableName: "${tableName}",
    source: "unmanaged",
    indexes: [],
    columns: [
      { name: "id", pgType: "uuid", notNull: true, primaryKey: true, defaultSql: "gen_random_uuid()" }${extra}
    ],
  },
];
`;
  writeFileSync(join(appCwd, "kumiko/schema.ts"), content);
}

describe("runSchemaCli — no-DB paths", () => {
  let appCwd: string;
  beforeEach(() => {
    appCwd = freshAppCwd();
  });

  test("default subcommand prints usage and exits 0", async () => {
    const cap = captureOut();
    const code = await runSchemaCli([], appCwd, cap.out);
    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("Subcommands:");
    expect(cap.err).toHaveLength(0);
  });

  test("unknown subcommand falls through to usage", async () => {
    const cap = captureOut();
    const code = await runSchemaCli(["lolwut"], appCwd, cap.out);
    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("Subcommands:");
  });

  test("generate without name exits 1 with neutral usage wording", async () => {
    const cap = captureOut();
    const code = await runSchemaCli(["generate"], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain("Usage: schema generate <name>");
    expect(cap.err.join("\n")).not.toContain("kumiko-schema");
  });

  test("generate with missing schema.ts exits 1", async () => {
    const cap = captureOut();
    const code = await runSchemaCli(["generate", "init"], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain("kumiko/schema.ts");
    expect(cap.err.join("\n")).toContain("fehlt");
  });

  test("generate writes 0001_<name>.sql + .snapshot.json and exits 0", async () => {
    writeSchemaFile(appCwd, "tbl_a");
    const cap = captureOut();
    const code = await runSchemaCli(["generate", "init"], appCwd, cap.out);
    expect(code).toBe(0);

    const migrationsDir = join(appCwd, "kumiko/migrations");
    expect(existsSync(migrationsDir)).toBe(true);
    const files = readdirSync(migrationsDir);
    expect(files).toContain("0001_init.sql");
    expect(files).toContain(".snapshot.json");

    const sql = readFileSync(join(migrationsDir, "0001_init.sql"), "utf8");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "tbl_a"');
  });

  test("generate second time without schema changes prints skip + exits 0", async () => {
    writeSchemaFile(appCwd, "tbl_a");
    const first = captureOut();
    await runSchemaCli(["generate", "init"], appCwd, first.out);

    const cap = captureOut();
    const code = await runSchemaCli(["generate", "noop"], appCwd, cap.out);
    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("No schema changes detected");
    const files = readdirSync(join(appCwd, "kumiko/migrations"));
    expect(files).not.toContain("0002_noop.sql");
  });

  test("apply without DATABASE_URL exits 1", async () => {
    const dbUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const cap = captureOut();
      const code = await runSchemaCli(["apply"], appCwd, cap.out);
      expect(code).toBe(1);
      expect(cap.err.join("\n")).toContain("DATABASE_URL not set");
    } finally {
      if (dbUrl !== undefined) process.env["DATABASE_URL"] = dbUrl;
    }
  });

  test("status without DATABASE_URL exits 1", async () => {
    const dbUrl = process.env["DATABASE_URL"];
    delete process.env["DATABASE_URL"];
    try {
      const cap = captureOut();
      const code = await runSchemaCli(["status"], appCwd, cap.out);
      expect(code).toBe(1);
      expect(cap.err.join("\n")).toContain("DATABASE_URL not set");
    } finally {
      if (dbUrl !== undefined) process.env["DATABASE_URL"] = dbUrl;
    }
  });

  test("status without kumiko/migrations exits 0 (legacy drizzle path)", async () => {
    const prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = "postgresql://placeholder:placeholder@localhost:1/placeholder";
    try {
      const cap = captureOut();
      const code = await runSchemaCli(["status"], appCwd, cap.out);
      expect(code).toBe(0);
      expect(cap.log.join("\n")).toContain("alten drizzle-Pfad");
    } finally {
      if (prevDbUrl !== undefined) process.env["DATABASE_URL"] = prevDbUrl;
      else delete process.env["DATABASE_URL"];
    }
  });
});

describe("runSchemaCli — DB-backed paths", () => {
  let testDb: BunTestDb;
  let dbUrl: string;
  let prevDbUrl: string | undefined;

  beforeAll(async () => {
    await ensureTemporalPolyfill();
    testDb = await createTestDb();
    const baseUrl =
      process.env["TEST_DATABASE_URL"] ??
      process.env["DATABASE_URL"] ??
      "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
    dbUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
    prevDbUrl = process.env["DATABASE_URL"];
    process.env["DATABASE_URL"] = dbUrl;
  });

  afterAll(async () => {
    if (prevDbUrl !== undefined) process.env["DATABASE_URL"] = prevDbUrl;
    else delete process.env["DATABASE_URL"];
    await testDb?.cleanup();
  });

  test("apply runs pending migrations, status reports 0 pending → exit 0", async () => {
    const appCwd = freshAppCwd();
    writeSchemaFile(appCwd, "tbl_apply_ok");
    await runSchemaCli(["generate", "apply_ok"], appCwd, captureOut().out);

    const applyCap = captureOut();
    const applyCode = await runSchemaCli(["apply"], appCwd, applyCap.out);
    expect(applyCode).toBe(0);
    expect(applyCap.log.join("\n")).toContain("Applied 1");

    const statusCap = captureOut();
    const statusCode = await runSchemaCli(["status"], appCwd, statusCap.out);
    expect(statusCode).toBe(0);
    expect(statusCap.log.join("\n")).toContain("0 pending");

    rmSync(appCwd, { recursive: true, force: true });
  });

  test("apply creates the framework-infra tables on a greenfield DB", async () => {
    // Regression-pin: a brand-new app (no legacy-drizzle cutover) only had its
    // entity-read tables after `apply`, so runProdApp's first event-store access
    // hit "relation kumiko_events does not exist". `apply` now ensures the
    // framework-infra tables (idempotent) so a greenfield deploy boots.
    const appCwd = freshAppCwd();
    writeSchemaFile(appCwd, "tbl_infra");
    await runSchemaCli(["generate", "infra_test"], appCwd, captureOut().out);
    await runSchemaCli(["apply"], appCwd, captureOut().out);

    const { db, close } = createDbConnection(dbUrl);
    try {
      for (const table of [
        "public.kumiko_events",
        "public.kumiko_snapshots",
        "public.kumiko_archived_streams",
        "public.kumiko_event_consumers",
        "public.kumiko_projections",
      ]) {
        expect(await tableExists(db, table)).toBe(true);
      }
    } finally {
      await close();
    }
    rmSync(appCwd, { recursive: true, force: true });
  });

  test("status with pending migrations exits 1 (regression-pin: CI-gating signal)", async () => {
    const appCwd = freshAppCwd();
    writeSchemaFile(appCwd, "tbl_pending");
    await runSchemaCli(["generate", "pending_test"], appCwd, captureOut().out);

    const statusCap = captureOut();
    const statusCode = await runSchemaCli(["status"], appCwd, statusCap.out);
    expect(statusCode).toBe(1);
    expect(statusCap.log.join("\n")).toContain("1 pending");

    rmSync(appCwd, { recursive: true, force: true });
  });

  test("apply on already-applied migrations is idempotent + exits 0", async () => {
    const appCwd = freshAppCwd();
    writeSchemaFile(appCwd, "tbl_idem");
    await runSchemaCli(["generate", "idem_test"], appCwd, captureOut().out);
    await runSchemaCli(["apply"], appCwd, captureOut().out);

    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out);
    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("already applied");

    rmSync(appCwd, { recursive: true, force: true });
  });

  test("baseline marks migrations applied without running SQL", async () => {
    const appCwd = freshAppCwd();
    writeSchemaFile(appCwd, "tbl_baseline");
    await runSchemaCli(["generate", "baseline_test"], appCwd, captureOut().out);

    const cap = captureOut();
    const code = await runSchemaCli(["baseline"], appCwd, cap.out);
    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("Marked 1 migration(s) as applied");

    const statusCap = captureOut();
    const statusCode = await runSchemaCli(["status"], appCwd, statusCap.out);
    expect(statusCode).toBe(0);
    expect(statusCap.log.join("\n")).toContain("0 pending");

    rmSync(appCwd, { recursive: true, force: true });
  });
});
