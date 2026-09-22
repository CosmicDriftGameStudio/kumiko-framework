// `schema apply`'s KMS wiring resolves the schema-declared slots
// (RunSchemaCliOptions["kmsSlots"]) instead of resolvePlatformKeks's
// LEGACY_SLOTS default. Real PgKmsAdapter + real blind-index decode, only
// globalThis.fetch is mocked (the Key Manager decrypt call).

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetBlindIndexKeyForTests } from "../crypto/blind-index";
import { resetPiiSubjectKmsForTests } from "../crypto/pii-field-encryption";
import { defineFeature } from "../engine";
import { runSchemaCli, type SchemaCliOut } from "../schema-cli";
import { createTestDb, type TestDb } from "../stack";
import { ensureTemporalPolyfill } from "../time/polyfill";

const feature = defineFeature("kmsslotstest", () => {});

const PLATFORM_KEK_PLAINTEXT = Buffer.alloc(32, 1).toString("base64");
const BLIND_INDEX_PLAINTEXT = Buffer.alloc(32, 2).toString("base64");
const PLATFORM_KEK_CIPHERTEXT = "ct-platform-kek";
const BLIND_INDEX_CIPHERTEXT = "ct-blind-index";
const PLATFORM_KEK_PREVIOUS_CIPHERTEXT = "ct-platform-kek-previous";

function captureOut(): { out: SchemaCliOut; log: string[]; err: string[] } {
  const log: string[] = [];
  const err: string[] = [];
  return { out: { log: (l) => log.push(l), err: (l) => err.push(l) }, log, err };
}

function writeAppWithTrivialMigration(migrationId: string): string {
  const appCwd = join(
    tmpdir(),
    `kumiko-kms-slots-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const migrationsDir = join(appCwd, "kumiko/migrations");
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, `${migrationId}.sql`), "SELECT 1;\n");
  return appCwd;
}

function mockDecryptFetch(
  ciphertextToPlaintext: Readonly<Record<string, string>>,
  requestedCiphertexts?: string[],
): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { ciphertext: string };
    requestedCiphertexts?.push(body.ciphertext);
    const plaintext = ciphertextToPlaintext[body.ciphertext];
    if (plaintext === undefined) {
      throw new Error(`mockDecryptFetch: no plaintext mapped for ciphertext "${body.ciphertext}"`);
    }
    return new Response(JSON.stringify({ plaintext }), { status: 200 });
  }) as typeof fetch;
}

const KMS_ENV_KEYS = [
  "DATABASE_URL",
  "SUBJECT_KEYS_DATABASE_URL",
  "PLATFORM_KEK",
  "PLATFORM_KEK_CIPHERTEXT",
  "PLATFORM_KEK_PREVIOUS",
  "PLATFORM_KEK_PREVIOUS_CIPHERTEXT",
  "PLATFORM_KEK_PREVIOUS_VERSION",
  "PLATFORM_KEK_KMS_KEY_ID",
  "PLATFORM_KEK_KMS_TOKEN",
  "PLATFORM_KEK_KMS_REGION",
  "KUMIKO_BLIND_INDEX_KEY",
  "KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT",
] as const;

let testDb: TestDb;
let testDbUrl: string;
let prevEnv: Record<string, string | undefined>;
let prevFetch: typeof fetch;

beforeAll(async () => {
  await ensureTemporalPolyfill();
  testDb = await createTestDb();
  const baseUrl =
    process.env["TEST_DATABASE_URL"] ??
    process.env["DATABASE_URL"] ??
    "postgresql://kumiko:kumiko@localhost:15432/kumiko_test";
  testDbUrl = baseUrl.replace(/\/[^/]+$/, `/${testDb.dbName}`);
});

afterAll(async () => {
  await testDb?.cleanup();
});

beforeEach(() => {
  prevEnv = {};
  for (const key of KMS_ENV_KEYS) prevEnv[key] = process.env[key];
  for (const key of KMS_ENV_KEYS) delete process.env[key];
  process.env["DATABASE_URL"] = testDbUrl;
  prevFetch = globalThis.fetch;
});

afterEach(() => {
  for (const key of KMS_ENV_KEYS) {
    if (prevEnv[key] === undefined) delete process.env[key];
    else process.env[key] = prevEnv[key];
  }
  globalThis.fetch = prevFetch;
  resetBlindIndexKeyForTests();
  resetPiiSubjectKmsForTests();
});

describe("runSchemaCli apply — kmsSlots", () => {
  test("resolves every declared slot from its Key Manager ciphertext", async () => {
    process.env["SUBJECT_KEYS_DATABASE_URL"] = testDbUrl;
    process.env["PLATFORM_KEK_CIPHERTEXT"] = PLATFORM_KEK_CIPHERTEXT;
    process.env["KUMIKO_BLIND_INDEX_KEY_CIPHERTEXT"] = BLIND_INDEX_CIPHERTEXT;
    process.env["PLATFORM_KEK_KMS_KEY_ID"] = "key-1";
    process.env["PLATFORM_KEK_KMS_TOKEN"] = "token-1";
    globalThis.fetch = mockDecryptFetch({
      [PLATFORM_KEK_CIPHERTEXT]: PLATFORM_KEK_PLAINTEXT,
      [BLIND_INDEX_CIPHERTEXT]: BLIND_INDEX_PLAINTEXT,
    });

    const appCwd = writeAppWithTrivialMigration("0001_init");
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, {
      features: [feature],
      kmsSlots: ["PLATFORM_KEK", "KUMIKO_BLIND_INDEX_KEY"],
    });

    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("PLATFORM_KEK source=key-manager");
    expect(cap.log.join("\n")).toContain("KUMIKO_BLIND_INDEX_KEY source=key-manager");
  });

  test("only resolves the declared slots — an undeclared _PREVIOUS ciphertext is left untouched", async () => {
    process.env["SUBJECT_KEYS_DATABASE_URL"] = testDbUrl;
    process.env["PLATFORM_KEK_CIPHERTEXT"] = PLATFORM_KEK_CIPHERTEXT;
    process.env["PLATFORM_KEK_PREVIOUS_CIPHERTEXT"] = PLATFORM_KEK_PREVIOUS_CIPHERTEXT;
    process.env["PLATFORM_KEK_KMS_KEY_ID"] = "key-1";
    process.env["PLATFORM_KEK_KMS_TOKEN"] = "token-1";
    process.env["KUMIKO_BLIND_INDEX_KEY"] = BLIND_INDEX_PLAINTEXT;
    const fetchCalls: string[] = [];
    globalThis.fetch = mockDecryptFetch(
      { [PLATFORM_KEK_CIPHERTEXT]: PLATFORM_KEK_PLAINTEXT },
      fetchCalls,
    );

    const appCwd = writeAppWithTrivialMigration("0001_init");
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, {
      features: [feature],
      kmsSlots: ["PLATFORM_KEK"],
    });

    expect(code).toBe(0);
    expect(fetchCalls).toEqual([PLATFORM_KEK_CIPHERTEXT]);
  });

  test("without kmsSlots, apply still resolves PLATFORM_KEK from its ciphertext (legacy default)", async () => {
    process.env["SUBJECT_KEYS_DATABASE_URL"] = testDbUrl;
    process.env["PLATFORM_KEK_CIPHERTEXT"] = PLATFORM_KEK_CIPHERTEXT;
    process.env["KUMIKO_BLIND_INDEX_KEY"] = BLIND_INDEX_PLAINTEXT;
    process.env["PLATFORM_KEK_KMS_KEY_ID"] = "key-1";
    process.env["PLATFORM_KEK_KMS_TOKEN"] = "token-1";
    globalThis.fetch = mockDecryptFetch({ [PLATFORM_KEK_CIPHERTEXT]: PLATFORM_KEK_PLAINTEXT });

    const appCwd = writeAppWithTrivialMigration("0001_init");
    const cap = captureOut();
    const code = await runSchemaCli(["apply"], appCwd, cap.out, { features: [feature] });

    expect(code).toBe(0);
    expect(cap.log.join("\n")).toContain("PLATFORM_KEK source=key-manager");
  });
});
