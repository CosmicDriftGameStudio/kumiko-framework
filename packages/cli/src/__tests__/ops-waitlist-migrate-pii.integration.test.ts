// `kumiko ops waitlist-migrate` writes name/email/message through the entity executor, so it
// must configure the PII key service from the env like the app boot, or abort loudly.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  publicstatusLegacyTable,
  waitlistEntryEntity,
  waitlistEntryTable,
  waitlistImportId,
} from "@cosmicdrift/kumiko-bundled-features/waitlist";
import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";
import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  deleteRows,
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
  seedRow,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { runCli } from "../index";

const LEGACY_TABLE = "legacy_publicstatus_waitlist";
const legacyTable = publicstatusLegacyTable(LEGACY_TABLE);
const EMAIL = "lead@apex.example";

const CONFIG_SOURCE = `export { default } from ${JSON.stringify(
  join(import.meta.dir, "fixtures", "waitlist-app.ts"),
)};
`;

const ENV_KEYS = [
  "DATABASE_URL",
  "SUBJECT_KEYS_DATABASE_URL",
  "PLATFORM_KEK",
  "KUMIKO_BLIND_INDEX_KEY",
] as const;

function capture(): {
  out: { log: (s: string) => void; err: (s: string) => void };
  logs: string[];
} {
  const logs: string[] = [];
  return { logs, out: { log: (s) => logs.push(s), err: (s) => logs.push(s) } };
}

describe("kumiko ops waitlist-migrate PII handling (real DB)", () => {
  let testDb: TestDb;
  let appDir: string;
  let legacyId = "";
  const tmpParent = join(import.meta.dir, ".tmp-ops-waitlist-migrate");
  const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  const args = [
    "ops",
    "waitlist-migrate",
    "--from",
    "publicstatus",
    "--source-table",
    LEGACY_TABLE,
  ];

  async function importedRows() {
    const id = waitlistImportId(`publicstatus:${legacyId}`);
    return selectMany(testDb.db, waitlistEntryTable, { id });
  }

  beforeAll(async () => {
    testDb = await createTestDb();
    mkdirSync(tmpParent, { recursive: true });
    appDir = mkdtempSync(join(tmpParent, "app-"));
    writeFileSync(join(appDir, "kumiko.config.ts"), CONFIG_SOURCE);
    await unsafeCreateEntityTable(testDb.db, waitlistEntryEntity);
    await unsafePushTables(testDb.db, { legacyTable });

    const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
    url.pathname = `/${testDb.dbName}`;
    process.env["DATABASE_URL"] = url.toString();
    process.env["SUBJECT_KEYS_DATABASE_URL"] = url.toString();
    process.env["PLATFORM_KEK"] = randomBytes(32).toString("base64");
    process.env["KUMIKO_BLIND_INDEX_KEY"] = randomBytes(32).toString("base64");
  });

  afterEach(async () => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
    await deleteRows(testDb.db, legacyTable, {});
  });

  afterAll(async () => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmpParent, { recursive: true, force: true });
    await testDb.cleanup();
  });

  async function seedLegacyRow(): Promise<void> {
    // Fresh id per test: the event store outlives the table reset.
    legacyId = crypto.randomUUID();
    await seedRow(testDb.db, legacyTable, {
      id: legacyId,
      email: EMAIL,
      createdAt: Temporal.Instant.from("2026-07-01T08:00:00Z"),
    });
  }

  async function createdPayload(): Promise<Record<string, unknown>> {
    const entryId = waitlistImportId(`publicstatus:${legacyId}`);
    const [created] = await loadAggregate(testDb.db, entryId, SYSTEM_TENANT_ID);
    const payload: unknown = created?.payload;
    if (typeof payload !== "object" || payload === null) throw new Error("created event missing");
    return Object.fromEntries(Object.entries(payload));
  }

  test("imports personal fields as ciphertext when the KMS env is configured", async () => {
    await seedLegacyRow();
    const { out, logs } = capture();
    expect(await runCli({ argv: args, cwd: appDir, out })).toBe(0);
    expect(logs.join("\n")).toContain("created 1");

    const payload = await createdPayload();
    expect(isPiiCiphertext(payload["email"])).toBe(true);
    expect(isPiiCiphertext(payload["name"])).toBe(true);
    expect(JSON.stringify(payload)).not.toContain(EMAIL);
  });

  describe("without the crypto env", () => {
    const cryptoEnvKeys = [
      "SUBJECT_KEYS_DATABASE_URL",
      "PLATFORM_KEK",
      "KUMIKO_BLIND_INDEX_KEY",
    ] as const;
    const saved = new Map<string, string | undefined>();

    beforeEach(() => {
      for (const key of cryptoEnvKeys) {
        saved.set(key, process.env[key]);
        delete process.env[key];
      }
    });

    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    });

    test("aborts without writing anything", async () => {
      await seedLegacyRow();
      const { out, logs } = capture();
      expect(await runCli({ argv: args, cwd: appDir, out })).toBe(1);
      const text = logs.join("\n");
      expect(text).toContain("--allow-plaintext-pii");
      expect(text).toContain("plaintext");
      expect(await importedRows()).toHaveLength(0);
    });

    test("an empty reason is rejected", async () => {
      await seedLegacyRow();
      const { out, logs } = capture();
      expect(
        await runCli({ argv: [...args, "--allow-plaintext-pii", " "], cwd: appDir, out }),
      ).toBe(1);
      expect(logs.join("\n")).toContain("requires a non-empty reason");
    });

    test("an explicit reason imports the entry as plaintext", async () => {
      await seedLegacyRow();
      const { out } = capture();
      const argv = [...args, "--allow-plaintext-pii", "app without subject encryption"];
      expect(await runCli({ argv, cwd: appDir, out })).toBe(0);
      expect((await createdPayload())["email"]).toBe(EMAIL);
    });
  });
});
