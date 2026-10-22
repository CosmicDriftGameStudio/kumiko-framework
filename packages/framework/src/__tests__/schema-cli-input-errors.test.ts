import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli.ts";

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

const PLACEHOLDER_DATABASE_URL = "postgresql://placeholder:placeholder@localhost:1/placeholder";

describe("runSchemaCli — rejected input without a database", () => {
  let appCwd: string;
  beforeEach(() => {
    appCwd = mkdtempSync(join(tmpdir(), "kumiko-schema-cli-input-errors-"));
    mkdirSync(join(appCwd, "kumiko"), { recursive: true });
  });
  afterEach(() => {
    rmSync(appCwd, { recursive: true, force: true });
  });

  function writeSchemaModule(source: string): void {
    writeFileSync(join(appCwd, "kumiko/schema.ts"), source);
  }

  test("validate reports a malformed FEATURES entry after the schema layer ran", async () => {
    writeSchemaModule(
      `export const ENTITY_METAS = [];\nexport const FEATURES = [{ name: "broken" }];\n`,
    );
    const cap = captureOut();
    const code = await runSchemaCli(["validate"], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain("✗ boot: FEATURES[0] is not a FeatureDefinition");
    expect(cap.log.join("\n")).toContain("✓ schema: migrations match the entity definitions");
  });

  test("generate rejects a schema file whose ENTITY_METAS is not an array", async () => {
    writeSchemaModule(`export const ENTITY_METAS = {};\n`);
    const cap = captureOut();
    const code = await runSchemaCli(["generate", "init"], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain(
      "must declare `export const ENTITY_METAS: EntityTableMeta[]`",
    );
  });

  test.each(["apply", "baseline"])(
    "%s without kumiko/migrations exits 1 before connecting",
    async (subcommand) => {
      await withEnv({ DATABASE_URL: PLACEHOLDER_DATABASE_URL }, async () => {
        const cap = captureOut();
        const code = await runSchemaCli([subcommand], appCwd, cap.out);
        expect(code).toBe(1);
        expect(cap.err.join("\n")).toContain("is missing — run schema generate <name> first.");
      });
    },
  );

  test("an empty subcommand is unknown, not a help request", async () => {
    const cap = captureOut();
    const code = await runSchemaCli([""], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain('Unknown subcommand: ""');
  });

  test("validate reports a migration the replay parser cannot read", async () => {
    writeSchemaModule(
      `export const ENTITY_METAS = [{ tableName: "read_widgets", source: "unmanaged", indexes: [], columns: [{ name: "id", pgType: "uuid", notNull: true, primaryKey: true }] }];\n`,
    );
    expect(await runSchemaCli(["generate", "init"], appCwd, captureOut().out)).toBe(0);
    const migrationsDir = join(appCwd, "kumiko/migrations");
    const sqlFile = readdirSync(migrationsDir).find((file) => file.endsWith(".sql"));
    if (sqlFile === undefined) throw new Error("generate wrote no migration file");
    appendFileSync(join(migrationsDir, sqlFile), "\nALTER TABLE read_widgets FROBNICATE;\n");
    const cap = captureOut();
    const code = await runSchemaCli(["validate"], appCwd, cap.out);
    expect(code).toBe(1);
    expect(cap.err.join("\n")).toContain("✗ migration-content:");
  });
});
