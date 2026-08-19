// PII on the jobs run-logger, direct-write path (#2243, formerly #799):
// run-started payload can carry arbitrary user data and is written straight
// into jobRunsTable (no event store, no event-PII catalog — #2243 removed
// the jobRun r.defineEvent registrations). With a KMS active the stored row
// carries ciphertext under the triggering user's DEK; erasing that key
// makes the payload unreadable ([[erased]]) without touching the row.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
} from "@cosmicdrift/kumiko-framework/crypto";
import { createRegistry } from "@cosmicdrift/kumiko-framework/engine";
import { createEventsTable, eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import {
  createTestDb,
  createTestRedis,
  type TestDb,
  type TestRedis,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { createJobRunLogger } from "../job-run-logger";
import { jobRunLogsTable, jobRunsTable } from "../job-run-table";

let testDb: TestDb;
let testRedis: TestRedis;
let logger: ReturnType<typeof createJobRunLogger>;
let kms: InMemoryKmsAdapter;

const USER_ID = "u-pii-9";
const SECRET_PAYLOAD = JSON.stringify({ iban: "DE89370400440532013000" });

beforeAll(async () => {
  testDb = await createTestDb();
  testRedis = await createTestRedis();
  const registry = createRegistry([createJobsFeature()]);
  await unsafePushTables(testDb.db, { jobRunsTable, jobRunLogsTable });
  // Kept only so the "no event store involved" assertion below has a table
  // to assert against — the write path itself never touches it.
  await createEventsTable(testDb.db);
  logger = createJobRunLogger({ db: testDb.db, registry });
});

afterAll(async () => {
  await testDb.cleanup();
  await testRedis.cleanup();
});

beforeEach(async () => {
  await resetTestTables(testDb.db, [eventsTable, jobRunsTable, jobRunLogsTable]);
  kms = new InMemoryKmsAdapter();
  configurePiiSubjectKms(kms);
});

afterEach(() => {
  resetPiiSubjectKmsForTests();
});

describe("jobs run-started payload under KMS", () => {
  test("stored row carries ciphertext payload, plaintext triggeredById — no event-store write", async () => {
    await logger.onJobStart?.("app:job:export", "bull-1", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
      attempt: 1,
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-1" });
    expect(isPiiCiphertext(row?.["payload"])).toBe(true);
    expect(String(row?.["payload"])).toContain(`user:${USER_ID}`);
    expect(row?.["triggeredById"]).toBe(USER_ID);

    const back = await decryptPiiFieldValues({ payload: row?.["payload"] }, ["payload"], kms, {
      requestId: "t",
    });
    expect(back["payload"]).toBe(SECRET_PAYLOAD);

    const events = await selectMany(testDb.db, eventsTable, { aggregateType: "jobRun" });
    expect(events).toHaveLength(0);
  });

  test("erase subject key → row payload decrypts to [[erased]]", async () => {
    await logger.onJobStart?.("app:job:export", "bull-2", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-2" });
    expect(isPiiCiphertext(row?.["payload"])).toBe(true);

    await kms.eraseKey({ kind: "user", userId: USER_ID });
    const after = await decryptPiiFieldValues({ payload: row?.["payload"] }, ["payload"], kms, {
      requestId: "t",
    });
    expect(after["payload"]).toBe(PII_ERASED_SENTINEL);
  });

  test("system run (no triggeredById) stays plaintext — no subject to shred", async () => {
    await logger.onJobStart?.("app:job:cron-sweep", "bull-3", {
      payload: JSON.stringify({ scope: "all" }),
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-3" });
    expect(row?.["payload"]).toBe(JSON.stringify({ scope: "all" }));
  });

  test("without a KMS the payload stays plaintext (rollout mode)", async () => {
    resetPiiSubjectKmsForTests();
    await logger.onJobStart?.("app:job:export", "bull-4", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-4" });
    expect(row?.["payload"]).toBe(SECRET_PAYLOAD);
  });
});
