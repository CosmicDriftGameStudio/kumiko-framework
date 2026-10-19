// `kumiko project rebuild` replays applyEntityEvent, which fills blind-index
// columns from the configured key. The CLI never boots the app, so the command
// must wire the KMS from the env itself or the rebuild nulls the bidx column.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createProjectionStateTable,
  listProjectionsWithState,
} from "@cosmicdrift/kumiko-framework/pipeline";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { runCli } from "../index";
import backfillApp, {
  BACKFILL_CONTACT_TABLE,
  backfillContactEntity,
} from "./fixtures/backfill-pii-app";

const TENANT = "00000000-0000-4000-8000-0000000000b2" as TenantId;
const CONTACT_ID = "00000000-0000-4000-8000-0000000000c2";

const CONFIG_SOURCE = `export { default } from ${JSON.stringify(
  join(import.meta.dir, "fixtures", "backfill-pii-app.ts"),
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

describe("kumiko project rebuild wires the blind-index key (real DB)", () => {
  let testDb: TestDb;
  let appDir: string;
  let projectionName: string;
  const tmpParent = join(import.meta.dir, ".tmp-project-rebuild-crypto");
  const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    testDb = await createTestDb();
    await createProjectionStateTable(testDb.db);
    mkdirSync(tmpParent, { recursive: true });
    appDir = mkdtempSync(join(tmpParent, "app-"));
    writeFileSync(join(appDir, "kumiko.config.ts"), CONFIG_SOURCE);
    await unsafeCreateEntityTable(testDb.db, backfillContactEntity);

    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
    await append(testDb.db, {
      aggregateId: CONTACT_ID,
      aggregateType: "clibfcontact",
      tenantId: TENANT,
      expectedVersion: 0,
      type: "clibfcontact.created",
      payload: { id: CONTACT_ID, email: "legacy@example.com", displayName: "Legacy" },
      metadata: { userId: "system" },
    });

    const all = await listProjectionsWithState(testDb.db, createRegistry(backfillApp.features), {
      includeImplicit: true,
    });
    const entityProjection = all.find((p) => p.sources.includes("clibfcontact"));
    if (!entityProjection) throw new Error("entity projection missing");
    projectionName = entityProjection.name;

    const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
    url.pathname = `/${testDb.dbName}`;
    process.env["DATABASE_URL"] = url.toString();
    process.env["SUBJECT_KEYS_DATABASE_URL"] = url.toString();
    process.env["PLATFORM_KEK"] = randomBytes(32).toString("base64");
    process.env["KUMIKO_BLIND_INDEX_KEY"] = randomBytes(32).toString("base64");

    // Encrypt the legacy event first, as the PII runbook does before any rebuild.
    const backfill = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii"], cwd: appDir, out: backfill.out })).toBe(0);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
  });

  afterAll(async () => {
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(tmpParent, { recursive: true, force: true });
    await testDb.cleanup();
  });

  test("keeps the blind index of a PII projection", async () => {
    const { out, logs } = capture();
    expect(await runCli({ argv: ["project", "rebuild", projectionName], cwd: appDir, out })).toBe(
      0,
    );
    expect(logs.join("\n")).toContain("events");
    const rows = await asRawClient(testDb.db).unsafe<{ email_bidx: string | null }>(
      `SELECT email_bidx FROM "${BACKFILL_CONTACT_TABLE}" WHERE id = $1`,
      [CONTACT_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.email_bidx).toMatch(/^kumiko-bidx:v1:/);
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

    test("aborts for an app with PII fields instead of nulling the blind index", async () => {
      const { out, logs } = capture();
      expect(await runCli({ argv: ["project", "rebuild", projectionName], cwd: appDir, out })).toBe(
        1,
      );
      expect(logs.join("\n")).toContain("--allow-plaintext-pii");
    });

    test("an empty reason is rejected", async () => {
      const { out, logs } = capture();
      const argv = ["project", "rebuild", projectionName, "--allow-plaintext-pii", " "];
      expect(await runCli({ argv, cwd: appDir, out })).toBe(1);
      expect(logs.join("\n")).toContain("requires a non-empty reason");
    });

    test("an explicit reason lets the rebuild past the gate", async () => {
      const { out, logs } = capture();
      const argv = ["project", "rebuild", projectionName, "--allow-plaintext-pii", "local copy"];
      await runCli({ argv, cwd: appDir, out });
      expect(logs.join("\n")).not.toContain("BOOT ABORTED");
    });
  });
});
