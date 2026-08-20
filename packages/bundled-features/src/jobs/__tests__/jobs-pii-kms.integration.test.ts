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
  setupTestStack,
  type TestDb,
  type TestRedis,
  type TestStack,
  TestUsers,
  unsafePushTables,
} from "@cosmicdrift/kumiko-framework/stack";
import { resetPiiSubjectKmsForTests, resetTestTables } from "@cosmicdrift/kumiko-framework/testing";
import { JobQueries } from "../constants";
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

// #2247: store_job_run_logs is the same unmanaged direct-write path as
// jobRunsTable.payload above — onJobComplete/onJobFailed batch-insert log
// lines straight from the BullMQ callback, with no event-PII catalog to
// lean on. Same subject (triggeredById), same encrypt-under-DEK treatment,
// same skip rules (null subject / no KMS stay plaintext).
describe("jobs run-completed/-failed log messages under KMS (#2247)", () => {
  const SECRET_LOG = "user export contained iban DE89370400440532013000";

  async function runIdFor(bullJobId: string): Promise<string> {
    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId });
    return String(row?.["id"]);
  }

  test("onJobComplete: stored log message is ciphertext, decrypts to original", async () => {
    await logger.onJobStart?.("app:job:export", "bull-c1", { triggeredById: USER_ID });
    await logger.onJobComplete?.("app:job:export", "bull-c1", 42, [
      { level: "info", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
    ]);

    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c1") });
    expect(logs).toHaveLength(1);
    expect(isPiiCiphertext(logs[0]?.["message"])).toBe(true);
    expect(String(logs[0]?.["message"])).toContain(`user:${USER_ID}`);

    const back = await decryptPiiFieldValues({ message: logs[0]?.["message"] }, ["message"], kms, {
      requestId: "t",
    });
    expect(back["message"]).toBe(SECRET_LOG);
  });

  test("onJobFailed: stored log message is ciphertext, decrypts to original", async () => {
    await logger.onJobStart?.("app:job:export", "bull-f1", { triggeredById: USER_ID });
    await logger.onJobFailed?.("app:job:export", "bull-f1", "boom", [
      { level: "error", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
    ]);

    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-f1") });
    expect(logs).toHaveLength(1);
    expect(isPiiCiphertext(logs[0]?.["message"])).toBe(true);

    const back = await decryptPiiFieldValues({ message: logs[0]?.["message"] }, ["message"], kms, {
      requestId: "t",
    });
    expect(back["message"]).toBe(SECRET_LOG);
  });

  test("erase subject key after write → completed log message decrypts to [[erased]]", async () => {
    await logger.onJobStart?.("app:job:export", "bull-c2", { triggeredById: USER_ID });
    await logger.onJobComplete?.("app:job:export", "bull-c2", 10, [
      { level: "info", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
    ]);
    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c2") });

    await kms.eraseKey({ kind: "user", userId: USER_ID });
    const after = await decryptPiiFieldValues({ message: logs[0]?.["message"] }, ["message"], kms, {
      requestId: "t",
    });
    expect(after["message"]).toBe(PII_ERASED_SENTINEL);
  });

  test("system run (no triggeredById) → completed log messages stay plaintext", async () => {
    await logger.onJobStart?.("app:job:cron-sweep", "bull-c3", {});
    await logger.onJobComplete?.("app:job:cron-sweep", "bull-c3", 5, [
      { level: "info", message: "plain sweep log", timestamp: Temporal.Now.instant() },
    ]);
    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c3") });
    expect(logs[0]?.["message"]).toBe("plain sweep log");
  });

  test("without a KMS the completed log message stays plaintext (rollout mode)", async () => {
    await logger.onJobStart?.("app:job:export", "bull-c4", { triggeredById: USER_ID });
    resetPiiSubjectKmsForTests();
    await logger.onJobComplete?.("app:job:export", "bull-c4", 5, [
      { level: "info", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
    ]);
    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c4") });
    expect(logs[0]?.["message"]).toBe(SECRET_LOG);
  });

  // Documents a gap rather than fixing it: if the subject's key is erased
  // between onJobStart and onJobComplete, encryptLogMessages' getOrCreateDek
  // throws KeyErasedError — same propagate-on-erased-key behavior as
  // onJobStart's own encryptStartedPayload (no catch there either). Here the
  // status updateMany already ran before the log insert throws, so the run
  // is left "completed" with its log batch dropped instead of forging a
  // plaintext fallback. Same wedge-state class #2246 tracks (job runs stuck
  // after abnormal termination) — not something this PR fixes.
  test("erase subject key BEFORE onJobComplete: log encryption throws, run status already landed as completed", async () => {
    await logger.onJobStart?.("app:job:export", "bull-c5", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await kms.eraseKey({ kind: "user", userId: USER_ID });

    let threw = false;
    try {
      await logger.onJobComplete?.("app:job:export", "bull-c5", 5, [
        { level: "info", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
      ]);
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-c5" });
    expect(row?.["status"]).toBe("completed");
    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c5") });
    expect(logs).toHaveLength(0);
  });
});

// The suite above proves the write side (row is ciphertext) and decrypts by
// calling decryptPiiFieldValues directly in the test body — neither touches
// detail.query.ts's own decrypt wrapper. This block dispatches the real
// jobs:query:details HTTP handler so a regression in those eleven lines
// (wrong AAD field name, log-array key access, the row/log spread) fails a
// test instead of shipping ciphertext to the job-run detail screen.
describe("jobs:query:details decrypts log messages end-to-end (#2247)", () => {
  let detailStack: TestStack;
  let detailLogger: ReturnType<typeof createJobRunLogger>;

  const DETAIL_USER_ID = "u-pii-detail-1";
  const SECRET_DETAIL_LOG = "user export contained iban DE89370400440532013000";

  beforeAll(async () => {
    detailStack = await setupTestStack({
      features: [createJobsFeature()],
      jobs: {
        consumerLane: "worker",
        queueNamePrefix: `kumiko-jobs-detail-pii-test-${Date.now()}`,
      },
    });
    await unsafePushTables(detailStack.db, { jobRunsTable, jobRunLogsTable });
    detailLogger = createJobRunLogger({ db: detailStack.db, registry: detailStack.registry });
  });

  afterAll(async () => {
    await detailStack.cleanup();
  });

  beforeEach(() => {
    configurePiiSubjectKms(new InMemoryKmsAdapter());
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("jobs:query:details returns plaintext log message even though the stored row is ciphertext", async () => {
    await detailLogger.onJobStart?.("app:job:export", "bull-detail-1", {
      triggeredById: DETAIL_USER_ID,
    });
    await detailLogger.onJobComplete?.("app:job:export", "bull-detail-1", 7, [
      { level: "info", message: SECRET_DETAIL_LOG, timestamp: Temporal.Now.instant() },
    ]);

    const row = await fetchOne(detailStack.db, jobRunsTable, { bullJobId: "bull-detail-1" });
    const runId = String(row?.["id"]);
    const storedLogs = await selectMany(detailStack.db, jobRunLogsTable, { runId });
    expect(isPiiCiphertext(storedLogs[0]?.["message"])).toBe(true);

    const result = await detailStack.http.queryOk<{
      logs: readonly { message: string }[];
    }>(JobQueries.details, { runId }, TestUsers.systemAdmin);

    expect(result.logs).toHaveLength(1);
    expect(result.logs[0]?.message).toBe(SECRET_DETAIL_LOG);
  });
});
