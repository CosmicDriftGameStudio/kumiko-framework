// `kumiko ops backfill-pii` drives the framework backfill against the app's
// kumiko.config.ts: plaintext events written before the KMS existed come out
// encrypted, a second run finds nothing left to do, and --rebuild carries the
// ciphertext into the projection table. The database belongs to the non-bypass application role with row level
// security on, so the tool only sees tenant rows because it opens its own system scope.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isPiiCiphertext } from "@cosmicdrift/kumiko-framework/crypto";
import { asRawClient } from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { append, loadAggregate } from "@cosmicdrift/kumiko-framework/event-store";
import {
  runInRowLevelSecurityScope,
  tenantRowLevelSecurityScope,
} from "@cosmicdrift/kumiko-framework/internal/row-level-security";
import { createProjectionStateTable } from "@cosmicdrift/kumiko-framework/pipeline";
import {
  resetBlindIndexKeyForTests,
  resetPiiSubjectKmsForTests,
} from "@cosmicdrift/kumiko-testing/helpers";
import {
  createTestDb,
  TEST_APPLICATION_ROLE,
  type TestDb,
  unsafeCreateEntityTable,
} from "@cosmicdrift/kumiko-testing/stack";
import { runCli } from "../index";
import { BACKFILL_CONTACT_TABLE, backfillContactEntity } from "./fixtures/backfill-pii-app";

const TENANT = "00000000-0000-4000-8000-0000000000b1" as TenantId;
const CONTACT_ID = "00000000-0000-4000-8000-0000000000c1";
const PLAINTEXT_EMAIL = "legacy@example.com";

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

async function createdPayload(testDb: TestDb): Promise<Record<string, unknown>> {
  const [created] = await loadAggregate(testDb.db, CONTACT_ID, TENANT);
  const payload: unknown = created?.payload;
  if (typeof payload !== "object" || payload === null) throw new Error("created event missing");
  return Object.fromEntries(Object.entries(payload));
}

describe("kumiko ops backfill-pii (real DB)", () => {
  let testDb: TestDb;
  let appDir: string;
  const tmpParent = join(import.meta.dir, ".tmp-ops-backfill");
  const previousEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

  beforeAll(async () => {
    testDb = await createTestDb({ applicationRole: true });
    await createProjectionStateTable(testDb.db);
    mkdirSync(tmpParent, { recursive: true });
    appDir = mkdtempSync(join(tmpParent, "app-"));
    writeFileSync(join(appDir, "kumiko.config.ts"), CONFIG_SOURCE);
    await unsafeCreateEntityTable(testDb.db, backfillContactEntity);

    // Plaintext era: no KMS configured while the legacy event is appended.
    resetPiiSubjectKmsForTests();
    resetBlindIndexKeyForTests();
    await append(testDb.db, {
      aggregateId: CONTACT_ID,
      aggregateType: "clibfcontact",
      tenantId: TENANT,
      expectedVersion: 0,
      type: "clibfcontact.created",
      payload: { id: CONTACT_ID, email: PLAINTEXT_EMAIL, displayName: "Legacy" },
      metadata: { userId: "system" },
    });

    const url = new URL(process.env["TEST_DATABASE_URL"] ?? "");
    url.pathname = `/${testDb.dbName}`;
    // The subject-keys schema is created lazily; the test DB stands in for the dedicated cluster.
    process.env["SUBJECT_KEYS_DATABASE_URL"] = url.toString();
    url.username = TEST_APPLICATION_ROLE;
    process.env["DATABASE_URL"] = url.toString();
    process.env["PLATFORM_KEK"] = randomBytes(32).toString("base64");
    process.env["KUMIKO_BLIND_INDEX_KEY"] = randomBytes(32).toString("base64");
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

  test("encrypts the plaintext event, then a second run changes nothing", async () => {
    expect((await createdPayload(testDb))["email"]).toBe(PLAINTEXT_EMAIL);

    const first = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii"], cwd: appDir, out: first.out })).toBe(0);
    expect(first.logs.join("\n")).toContain('"updatedEvents": 1');
    expect(first.logs.join("\n")).not.toContain(PLAINTEXT_EMAIL);

    const payload = await createdPayload(testDb);
    expect(isPiiCiphertext(payload["email"])).toBe(true);
    expect(payload["displayName"]).toBe("Legacy");

    const second = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii"], cwd: appDir, out: second.out })).toBe(0);
    expect(second.logs.join("\n")).toContain('"updatedEvents": 0');
    expect(await createdPayload(testDb)).toEqual(payload);
  });

  test("--rebuild materializes the ciphertext into the projection table", async () => {
    const { out, logs } = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii", "--rebuild"], cwd: appDir, out })).toBe(0);
    expect(logs.join("\n")).toContain("rebuilt");
    const rows = await runInRowLevelSecurityScope(tenantRowLevelSecurityScope(TENANT), () =>
      asRawClient(testDb.db).unsafe<{ email: string }>(
        `SELECT email FROM "${BACKFILL_CONTACT_TABLE}" WHERE id = $1`,
        [CONTACT_ID],
      ),
    );
    expect(rows).toHaveLength(1);
    expect(isPiiCiphertext(rows[0]?.email)).toBe(true);
  });

  test("an unknown flag exits 1 before touching the database", async () => {
    const { out, logs } = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii", "--dryrun"], cwd: appDir, out })).toBe(1);
    expect(logs.join("\n")).toContain("unknown flag: --dryrun");
  });

  test("a config that fails registry validation exits 1 and releases the KMS connections", async () => {
    const brokenDir = mkdtempSync(join(tmpParent, "broken-"));
    writeFileSync(
      join(brokenDir, "kumiko.config.ts"),
      `export { default } from ${JSON.stringify(
        join(import.meta.dir, "fixtures", "backfill-pii-missing-dependency-app.ts"),
      )};\n`,
    );
    const connectionCount = async (): Promise<number> => {
      const rows = await asRawClient(testDb.db).unsafe<{ count: string }>(
        "SELECT count(*)::text AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
        [testDb.dbName],
      );
      return Number(rows[0]?.count);
    };
    const before = await connectionCount();
    const { out, logs } = capture();
    expect(await runCli({ argv: ["ops", "backfill-pii"], cwd: brokenDir, out })).toBe(1);
    expect(logs.join("\n")).toContain("backfill-pii");
    expect(await connectionCount()).toBeLessThanOrEqual(before);
  });
});
