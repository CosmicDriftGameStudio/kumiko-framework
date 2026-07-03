// Event-PII on the jobs run-logger (#799): runStarted.payload can carry
// arbitrary user data and is written via LOW-LEVEL append() (not
// ctx.appendEvent) — exactly the path the event-PII catalog must cover.
// With a KMS active the stored event AND the projected read-row carry
// ciphertext under the triggering user's DEK; erasing that key makes the
// payload unreadable ([[erased]]) without touching the append-only stream.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { fetchOne, selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import {
  configurePiiSubjectKms,
  decryptPiiFieldValues,
  InMemoryKmsAdapter,
  isPiiCiphertext,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
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
import { resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { createJobsFeature } from "../feature";
import { createJobRunLogger, JOB_RUN_STARTED_EVENT } from "../job-run-logger";
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
  // createRegistry publishes the event-PII catalog as a module singleton —
  // the logger's low-level append() picks it up without further wiring.
  const registry = createRegistry([createJobsFeature()]);
  await unsafePushTables(testDb.db, { jobRunsTable, jobRunLogsTable });
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
  test("stored event carries ciphertext payload, plaintext triggeredById", async () => {
    await logger.onJobStart?.("app:job:export", "bull-1", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
      attempt: 1,
    });

    const events = await selectMany(testDb.db, eventsTable, { type: JOB_RUN_STARTED_EVENT });
    expect(events.length).toBe(1);
    const payload = events[0]?.payload as Record<string, unknown>;
    expect(isPiiCiphertext(payload["payload"])).toBe(true);
    expect(String(payload["payload"])).toContain(`user:${USER_ID}`);
    expect(payload["triggeredById"]).toBe(USER_ID);

    const back = await decryptPiiFieldValues(payload, ["payload"], kms, { requestId: "t" });
    expect(back["payload"]).toBe(SECRET_PAYLOAD);
  });

  test("projected read-row carries the same ciphertext; erase → [[erased]]", async () => {
    await logger.onJobStart?.("app:job:export", "bull-2", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-2" });
    expect(isPiiCiphertext(row?.["payload"])).toBe(true);

    await kms.eraseKey(
      { kind: "user", userId: USER_ID },
      { requestId: "t", eraseReason: "test-forget" },
    );
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
