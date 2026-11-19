// `schema apply` in the bundled CLI takes its KMS decision from the app's kmsMode (kumiko.config.ts)
// through productionKmsMode, the same decision bin/main.ts boots with.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { KmsMode } from "@cosmicdrift/kumiko-framework/crypto";
import { tableExists } from "@cosmicdrift/kumiko-framework/db";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import { withEnv } from "@cosmicdrift/kumiko-testing/helpers";
import { createTestDb, type TestDb } from "@cosmicdrift/kumiko-testing/stack";
import { runStandaloneCli, type StandaloneCliOut } from "../standalone-cli.ts";

const PLAINTEXT_REASON = "demo app without customer data";

const KMS_ENV_ABSENT = {
  SUBJECT_KEYS_DATABASE_URL: undefined,
  PLATFORM_KEK: undefined,
  PLATFORM_KEK_CIPHERTEXT: undefined,
  PLATFORM_KEK_PREVIOUS: undefined,
  PLATFORM_KEK_PREVIOUS_CIPHERTEXT: undefined,
  PLATFORM_KEK_PREVIOUS_VERSION: undefined,
  KUMIKO_BLIND_INDEX_KEY: undefined,
  KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT: undefined,
} as const;

const feature = defineFeature("standaloneclikms", () => {});
const envSchema = composeEnvSchema({ features: [feature] });

let testDb: TestDb;
let testDbUrl: string;
const appRoots: string[] = [];

beforeAll(async () => {
  testDb = await createTestDb();
  const baseUrl = process.env["TEST_DATABASE_URL"];
  if (baseUrl === undefined) throw new Error("TEST_DATABASE_URL is not set");
  testDbUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
});

afterAll(async () => {
  for (const root of appRoots) rmSync(root, { recursive: true, force: true });
  await testDb?.cleanup();
});

function writeAppCreatingTable(migrationId: string, table: string): string {
  const appCwd = mkdtempSync(join(tmpdir(), "kumiko-standalone-kms-"));
  appRoots.push(appCwd);
  const migrationsDir = join(appCwd, "kumiko/migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, `${migrationId}.sql`), `CREATE TABLE ${table} (id integer);\n`);
  return appCwd;
}

async function schemaApply(
  appCwd: string,
  nodeEnv: string | undefined,
  kmsMode: KmsMode | undefined,
): Promise<{ code: number; log: string[]; err: string[] }> {
  const log: string[] = [];
  const err: string[] = [];
  const out: StandaloneCliOut = { log: (l) => log.push(l), err: (l) => err.push(l) };
  const code = await withEnv(
    { ...KMS_ENV_ABSENT, DATABASE_URL: testDbUrl, NODE_ENV: nodeEnv },
    () =>
      runStandaloneCli(["schema", "apply"], appCwd, out, {
        features: [feature],
        envSchema,
        ...(kmsMode !== undefined && { kmsMode }),
      }),
  );
  return { code, log, err };
}

describe("runStandaloneCli schema apply — kmsMode", () => {
  test("production with a plaintext kmsMode applies without the KMS env and logs the reason", async () => {
    const table = "standalone_kms_plaintext_probe";
    const appCwd = writeAppCreatingTable("0001_plaintext_probe", table);

    const result = await schemaApply(appCwd, "production", { plaintextReason: PLAINTEXT_REASON });

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.log.join("\n")).toContain(PLAINTEXT_REASON);
    expect(await tableExists(testDb.db, table)).toBe(true);
  });

  test("production without kmsMode requires the KMS env and exits 1 before any migration", async () => {
    const table = "standalone_kms_required_probe";
    const appCwd = writeAppCreatingTable("0002_required_probe", table);

    const result = await schemaApply(appCwd, "production", undefined);

    expect(result.code).toBe(1);
    expect(result.err.length).toBeGreaterThan(0);
    expect(await tableExists(testDb.db, table)).toBe(false);
  });

  test("outside production kmsMode required does not demand the KMS env", async () => {
    const table = "standalone_kms_dev_probe";
    const appCwd = writeAppCreatingTable("0003_dev_probe", table);

    const result = await schemaApply(appCwd, undefined, "required");

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(await tableExists(testDb.db, table)).toBe(true);
  });
});
