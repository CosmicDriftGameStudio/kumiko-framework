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
import { sql } from "@cosmicdrift/kumiko-framework/db";
import { createRegistry, defineFeature, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
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
import {
  resetPiiSubjectKmsForTests,
  resetTestTables,
  seedRow,
  sleep,
} from "@cosmicdrift/kumiko-framework/testing";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { JobHandlers, JobQueries } from "../constants";
import { STALE_JOB_RUN_ERROR, markStaleJobRunsFailed } from "../db/queries/stale-run-sweep";
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

  // Mirrors the log-message/error cases below: a key already erased by the
  // time a new run starts must not blow up onJobStart itself — the run row
  // still has to land, even if the triggering user's key is gone.
  test("erase subject key BEFORE onJobStart: payload lands as [[erased]] instead of throwing", async () => {
    // First run creates the subject's key — eraseKey is a no-op on an
    // unknown subject (InMemoryKmsAdapter's tombstone contract), so the key
    // has to exist before it can be erased.
    await logger.onJobStart?.("app:job:export", "bull-2b", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await kms.eraseKey({ kind: "user", userId: USER_ID });

    await logger.onJobStart?.("app:job:export", "bull-2c", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-2c" });
    expect(row?.["payload"]).toBe(PII_ERASED_SENTINEL);
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

  // #2307: a key erased between onJobStart and onJobComplete no longer
  // blows up the callback. encryptLogMessages catches KeyErasedError per
  // log line and falls back to the sentinel (mirroring
  // decryptPiiValueForSubject on the read side) instead of throwing and
  // dropping the whole batch — the status updateMany already committed by
  // this point, so a thrown error would lose the log batch for nothing.
  test("erase subject key BEFORE onJobComplete: log message lands as [[erased]] instead of throwing", async () => {
    await logger.onJobStart?.("app:job:export", "bull-c5", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await kms.eraseKey({ kind: "user", userId: USER_ID });

    await logger.onJobComplete?.("app:job:export", "bull-c5", 5, [
      { level: "info", message: SECRET_LOG, timestamp: Temporal.Now.instant() },
    ]);

    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId: "bull-c5" });
    expect(row?.["status"]).toBe("completed");
    const logs = await selectMany(testDb.db, jobRunLogsTable, { runId: await runIdFor("bull-c5") });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.["message"]).toBe(PII_ERASED_SENTINEL);
  });
});

// #2307: onJobFailed's `error` argument was the one plaintext leak left in
// this table — encryptLogMessages already encrypted logs[].message under
// the same triggeredById, but the sibling `error` column (same underlying
// string in job-runner.ts, since it pushes errorMsg into both the log
// batch and the onJobFailed argument) stayed plaintext. Same subject, same
// encrypt-under-DEK treatment, same skip rules as the logs above.
describe("jobs run-failed error column under KMS (#2307)", () => {
  const SECRET_ERROR = "export failed for iban DE89370400440532013000";

  async function runIdFor(bullJobId: string): Promise<string> {
    const row = await fetchOne(testDb.db, jobRunsTable, { bullJobId });
    return String(row?.["id"]);
  }

  test("onJobFailed: stored error column is ciphertext, decrypts to original", async () => {
    await logger.onJobStart?.("app:job:export", "bull-e1", { triggeredById: USER_ID });
    await logger.onJobFailed?.("app:job:export", "bull-e1", SECRET_ERROR, []);

    const row = await fetchOne(testDb.db, jobRunsTable, { id: await runIdFor("bull-e1") });
    expect(isPiiCiphertext(row?.["error"])).toBe(true);
    expect(String(row?.["error"])).toContain(`user:${USER_ID}`);

    const back = await decryptPiiFieldValues({ error: row?.["error"] }, ["error"], kms, {
      requestId: "t",
    });
    expect(back["error"]).toBe(SECRET_ERROR);
  });

  test("erase subject key after write → error column decrypts to [[erased]]", async () => {
    await logger.onJobStart?.("app:job:export", "bull-e2", { triggeredById: USER_ID });
    await logger.onJobFailed?.("app:job:export", "bull-e2", SECRET_ERROR, []);
    const row = await fetchOne(testDb.db, jobRunsTable, { id: await runIdFor("bull-e2") });

    await kms.eraseKey({ kind: "user", userId: USER_ID });
    const after = await decryptPiiFieldValues({ error: row?.["error"] }, ["error"], kms, {
      requestId: "t",
    });
    expect(after["error"]).toBe(PII_ERASED_SENTINEL);
  });

  // Mirrors the log-message case above: a key erased between onJobStart and
  // onJobFailed must not blow up the failure callback — the run's own
  // failure still has to land, even if the triggering user's key is gone.
  test("erase subject key BEFORE onJobFailed: error column lands as [[erased]] instead of throwing", async () => {
    // payload creates the subject's key during onJobStart — eraseKey is a
    // no-op on an unknown subject (InMemoryKmsAdapter's tombstone contract),
    // so the key has to exist before it can be erased.
    await logger.onJobStart?.("app:job:export", "bull-e3", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await kms.eraseKey({ kind: "user", userId: USER_ID });

    await logger.onJobFailed?.("app:job:export", "bull-e3", SECRET_ERROR, []);

    const row = await fetchOne(testDb.db, jobRunsTable, { id: await runIdFor("bull-e3") });
    expect(row?.["status"]).toBe("failed");
    expect(row?.["error"]).toBe(PII_ERASED_SENTINEL);
  });

  test("system run (no triggeredById) → error column stays plaintext", async () => {
    await logger.onJobStart?.("app:job:cron-sweep", "bull-e4", {});
    await logger.onJobFailed?.("app:job:cron-sweep", "bull-e4", "plain sweep failure", []);
    const row = await fetchOne(testDb.db, jobRunsTable, { id: await runIdFor("bull-e4") });
    expect(row?.["error"]).toBe("plain sweep failure");
  });

  test("without a KMS the error column stays plaintext (rollout mode)", async () => {
    await logger.onJobStart?.("app:job:export", "bull-e5", { triggeredById: USER_ID });
    resetPiiSubjectKmsForTests();
    await logger.onJobFailed?.("app:job:export", "bull-e5", SECRET_ERROR, []);
    const row = await fetchOne(testDb.db, jobRunsTable, { id: await runIdFor("bull-e5") });
    expect(row?.["error"]).toBe(SECRET_ERROR);
  });
});

// markStaleJobRunsFailed (stale-run-sweep.ts) is a second, separate writer
// of the `error` column outside onJobFailed's per-row encrypt above — a
// crash-recovery batch sweep that can match many rows belonging to
// different triggering users in one pass. It must encrypt `error` per row
// under each row's own subject instead of writing STALE_JOB_RUN_ERROR in
// the clear, or a live KMS would leave plaintext sitting next to
// ciphertext siblings and detail.query.ts's decrypt would fail loud on it.
describe("jobs stale-run sweep error column under KMS", () => {
  async function seedStaleRunning(triggeredById?: string): Promise<string> {
    const id = generateId();
    await seedRow(testDb.db, jobRunsTable, {
      id,
      tenantId: SYSTEM_TENANT_ID,
      insertedById: "system",
      jobName: "app:job:export",
      bullJobId: `bull-${id}`,
      status: "running",
      attempt: 1,
      startedAt: sql`now() - interval '48 hours'`,
      ...(triggeredById !== undefined ? { triggeredById } : {}),
    });
    return id;
  }

  test("stale row's error is stored as ciphertext under its own triggering user, not the sentinel", async () => {
    const id = await seedStaleRunning(USER_ID);

    const result = await markStaleJobRunsFailed(testDb.db, 24);
    expect(result.runsMarkedFailed).toBe(1);

    const row = await fetchOne(testDb.db, jobRunsTable, { id });
    expect(row?.["status"]).toBe("failed");
    expect(isPiiCiphertext(row?.["error"])).toBe(true);
    expect(String(row?.["error"])).toContain(`user:${USER_ID}`);

    const back = await decryptPiiFieldValues({ error: row?.["error"] }, ["error"], kms, {
      requestId: "t",
    });
    expect(back["error"]).toBe(STALE_JOB_RUN_ERROR);
  });

  test("two stale rows from different users each decrypt under their own key", async () => {
    const OTHER_USER_ID = "u-pii-stale-other";
    const idA = await seedStaleRunning(USER_ID);
    const idB = await seedStaleRunning(OTHER_USER_ID);

    const result = await markStaleJobRunsFailed(testDb.db, 24);
    expect(result.runsMarkedFailed).toBe(2);

    const rowA = await fetchOne(testDb.db, jobRunsTable, { id: idA });
    const rowB = await fetchOne(testDb.db, jobRunsTable, { id: idB });
    expect(String(rowA?.["error"])).toContain(`user:${USER_ID}`);
    expect(String(rowB?.["error"])).toContain(`user:${OTHER_USER_ID}`);

    const backB = await decryptPiiFieldValues({ error: rowB?.["error"] }, ["error"], kms, {
      requestId: "t",
    });
    expect(backB["error"]).toBe(STALE_JOB_RUN_ERROR);
  });

  test("erase subject key before the sweep runs → error lands as the erased sentinel, sweep still succeeds", async () => {
    // Create the subject's key first — eraseKey is a no-op on an unknown
    // subject (InMemoryKmsAdapter's tombstone contract), same as the
    // onJobFailed case above. A payload is required here: onJobStart only
    // touches the KMS (creating the subject's key) when there's a payload
    // to encrypt (see encryptStartedPayload's null short-circuit).
    await logger.onJobStart?.("app:job:export", "bull-warm-key", {
      triggeredById: USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await kms.eraseKey({ kind: "user", userId: USER_ID });

    const id = await seedStaleRunning(USER_ID);

    const result = await markStaleJobRunsFailed(testDb.db, 24);
    expect(result.runsMarkedFailed).toBe(1);

    const row = await fetchOne(testDb.db, jobRunsTable, { id });
    expect(row?.["status"]).toBe("failed");
    expect(row?.["error"]).toBe(PII_ERASED_SENTINEL);
  });

  test("system-triggered stale row (no triggeredById) keeps a plaintext error", async () => {
    const id = await seedStaleRunning();

    await markStaleJobRunsFailed(testDb.db, 24);

    const row = await fetchOne(testDb.db, jobRunsTable, { id });
    expect(row?.["error"]).toBe(STALE_JOB_RUN_ERROR);
  });

  test("without a KMS the error column stays plaintext (rollout mode)", async () => {
    const id = await seedStaleRunning(USER_ID);
    resetPiiSubjectKmsForTests();

    await markStaleJobRunsFailed(testDb.db, 24);

    const row = await fetchOne(testDb.db, jobRunsTable, { id });
    expect(row?.["error"]).toBe(STALE_JOB_RUN_ERROR);
  });
});

// The suite above proves the write side (row is ciphertext) and decrypts by
// calling decryptPiiFieldValues directly in the test body — neither touches
// detail.query.ts's own decrypt wrapper. This block dispatches the real
// jobs:query:details HTTP handler so a regression in those eleven lines
// (wrong AAD field name, log-array key access, the row/log spread) fails a
// test instead of shipping ciphertext to the job-run detail screen.
describe("jobs:query:details decrypts log messages and error end-to-end (#2247, #2307)", () => {
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

  test("jobs:query:details returns plaintext error even though the stored row is ciphertext", async () => {
    const SECRET_DETAIL_ERROR = "export failed for iban DE89370400440532013000";
    await detailLogger.onJobStart?.("app:job:export", "bull-detail-2", {
      triggeredById: DETAIL_USER_ID,
    });
    await detailLogger.onJobFailed?.("app:job:export", "bull-detail-2", SECRET_DETAIL_ERROR, []);

    const row = await fetchOne(detailStack.db, jobRunsTable, { bullJobId: "bull-detail-2" });
    const runId = String(row?.["id"]);
    expect(isPiiCiphertext(row?.["error"])).toBe(true);

    const result = await detailStack.http.queryOk<{ error: string }>(
      JobQueries.details,
      { runId },
      TestUsers.systemAdmin,
    );

    expect(result.error).toBe(SECRET_DETAIL_ERROR);
  });

  test("jobs:query:list returns plaintext payload + error even though the stored row is ciphertext", async () => {
    const SECRET_LIST_ERROR = "export failed for iban DE89370400440532013000";
    // Distinct jobName + filter — this describe block's beforeEach swaps in a
    // brand-new KMS per test, so earlier tests' rows are still in this
    // shared table but encrypted under keys the current KMS instance no
    // longer holds. An unfiltered list() would sweep those up too and fail
    // to decrypt them.
    const jobName = "app:job:export-list-pii-test";
    await detailLogger.onJobStart?.(jobName, "bull-detail-3", {
      triggeredById: DETAIL_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await detailLogger.onJobFailed?.(jobName, "bull-detail-3", SECRET_LIST_ERROR, []);

    const row = await fetchOne(detailStack.db, jobRunsTable, { bullJobId: "bull-detail-3" });
    expect(isPiiCiphertext(row?.["payload"])).toBe(true);
    expect(isPiiCiphertext(row?.["error"])).toBe(true);

    const result = await detailStack.http.queryOk<{
      rows: readonly { id: string; payload: string | null; error: string | null }[];
    }>(JobQueries.list, { jobName, limit: 50 }, TestUsers.systemAdmin);

    const listed = result.rows.find((r) => r.id === String(row?.["id"]));
    expect(listed?.payload).toBe(SECRET_PAYLOAD);
    expect(listed?.error).toBe(SECRET_LIST_ERROR);
  });
});

// #2465: jobs:write:retry read run.payload straight off the row and
// JSON.parse'd it without decrypting first — broken on main for any retry
// of a run whose payload was encrypted under the triggering user's DEK
// (#799). This dispatches the real jobs:write:retry HTTP handler so a
// regression (missing decrypt, wrong AAD field name, sentinel mishandled)
// fails a test instead of shipping a crash to the retry button.
describe("jobs:write:retry decrypts payload before dispatch (#2465)", () => {
  let retryStack: TestStack;
  let retryLogger: ReturnType<typeof createJobRunLogger>;
  let retryKms: InMemoryKmsAdapter;

  const RETRY_USER_ID = "u-pii-retry-1";
  const RETRY_JOB_NAME = "retryapp:job:capture-import";
  const capturedPayloads: Record<string, unknown>[] = [];
  const capturedTriggeredBy: (string | null)[] = [];

  const retryAppFeature = defineFeature("retryapp", (r) => {
    r.job("captureImport", { trigger: { manual: true } }, async (payload, ctx) => {
      capturedPayloads.push(payload);
      capturedTriggeredBy.push(ctx.triggeredBy?.id ?? null);
    });
  });

  beforeAll(async () => {
    retryStack = await setupTestStack({
      features: [retryAppFeature, createJobsFeature()],
      jobs: {
        consumerLane: "worker",
        queueNamePrefix: `kumiko-jobs-retry-pii-test-${Date.now()}`,
      },
    });
    await unsafePushTables(retryStack.db, { jobRunsTable, jobRunLogsTable });
    retryLogger = createJobRunLogger({ db: retryStack.db, registry: retryStack.registry });
  });

  afterAll(async () => {
    await retryStack.cleanup();
  });

  beforeEach(() => {
    capturedPayloads.length = 0;
    capturedTriggeredBy.length = 0;
    retryKms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(retryKms);
  });

  afterEach(() => {
    resetPiiSubjectKmsForTests();
  });

  test("retry decrypts an encrypted run payload and dispatches the plaintext", async () => {
    await retryLogger.onJobStart?.(RETRY_JOB_NAME, "bull-retry-1", {
      triggeredById: RETRY_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await retryLogger.onJobFailed?.(RETRY_JOB_NAME, "bull-retry-1", "boom", []);

    const row = await fetchOne(retryStack.db, jobRunsTable, { bullJobId: "bull-retry-1" });
    expect(isPiiCiphertext(row?.["payload"])).toBe(true);
    expect(row?.["status"]).toBe("failed");

    const result = await retryStack.http.writeOk<{
      jobName: string;
      bullJobId: string;
      retriedFromRunId: string;
    }>(JobHandlers.retry, { runId: row?.["id"] }, TestUsers.systemAdmin);
    expect(result.jobName).toBe(RETRY_JOB_NAME);

    await sleep(1000);

    expect(capturedPayloads).toHaveLength(1);
    expect(capturedPayloads[0]).toEqual(JSON.parse(SECRET_PAYLOAD));
  });

  test("retry on a run whose payload key was erased is rejected instead of crashing", async () => {
    await retryLogger.onJobStart?.(RETRY_JOB_NAME, "bull-retry-2", {
      triggeredById: RETRY_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await retryLogger.onJobFailed?.(RETRY_JOB_NAME, "bull-retry-2", "boom", []);

    const row = await fetchOne(retryStack.db, jobRunsTable, { bullJobId: "bull-retry-2" });
    await retryKms.eraseKey({ kind: "user", userId: RETRY_USER_ID });

    const errInfo = await retryStack.http.writeErr(
      JobHandlers.retry,
      { runId: row?.["id"] },
      TestUsers.systemAdmin,
    );
    expect(errInfo.code).toBe("unprocessable");
    expect(errInfo.details).toMatchObject({ reason: "job_payload_erased" });
  });

  // #2469: retry dispatched without a `meta` argument, so the retried run
  // carried no triggeredById at all — job-run-logger's onJobStart then saw
  // triggeredById: null, skipped encryption entirely, and the retried run's
  // payload landed in job_runs as unshreddable plaintext. The asserted
  // invariant is the input to that chain: the retried BullMQ job must carry
  // the ORIGINAL run's owner, not the retrying SystemAdmin and not null.
  // (Asserting the retried run's job_runs row directly is not possible here:
  // this stack wires no job-run-logger into the runner, so a real dispatch
  // writes no row — every other row in this file is seeded by calling
  // retryLogger.onJobStart by hand.)
  test("retry re-dispatches with the original run's triggeredById so the new run's payload stays encrypted", async () => {
    await retryLogger.onJobStart?.(RETRY_JOB_NAME, "bull-retry-5", {
      triggeredById: RETRY_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await retryLogger.onJobFailed?.(RETRY_JOB_NAME, "bull-retry-5", "boom", []);

    const originalRow = await fetchOne(retryStack.db, jobRunsTable, { bullJobId: "bull-retry-5" });
    expect(isPiiCiphertext(originalRow?.["payload"])).toBe(true);
    expect(originalRow?.["triggeredById"]).toBe(RETRY_USER_ID);

    await retryStack.http.writeOk<{
      jobName: string;
      bullJobId: string;
      retriedFromRunId: string;
    }>(JobHandlers.retry, { runId: originalRow?.["id"] }, TestUsers.systemAdmin);

    await sleep(1000);

    expect(capturedTriggeredBy).toEqual([RETRY_USER_ID]);
    expect(capturedTriggeredBy[0]).not.toBe(TestUsers.systemAdmin.id);
    expect(capturedPayloads).toEqual([JSON.parse(SECRET_PAYLOAD)]);
  });

  // The other producer of PII_ERASED_SENTINEL: job-run-logger writes the
  // literal "[[erased]]" string (not ciphertext) when the key is already
  // gone at onJobStart time (see the mirrored case above this describe
  // block). retry.write.ts's isPiiCiphertext/decrypt path must reject this
  // stored sentinel the same way it rejects a decrypt-time one.
  test("retry on a run whose payload was stored as the erased sentinel is rejected", async () => {
    await retryLogger.onJobStart?.(RETRY_JOB_NAME, "bull-retry-3", {
      triggeredById: RETRY_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await retryKms.eraseKey({ kind: "user", userId: RETRY_USER_ID });

    await retryLogger.onJobStart?.(RETRY_JOB_NAME, "bull-retry-4", {
      triggeredById: RETRY_USER_ID,
      payload: SECRET_PAYLOAD,
    });
    await retryLogger.onJobFailed?.(RETRY_JOB_NAME, "bull-retry-4", "boom", []);

    const row = await fetchOne(retryStack.db, jobRunsTable, { bullJobId: "bull-retry-4" });
    expect(row?.["payload"]).toBe(PII_ERASED_SENTINEL);

    const errInfo = await retryStack.http.writeErr(
      JobHandlers.retry,
      { runId: row?.["id"] },
      TestUsers.systemAdmin,
    );
    expect(errInfo.code).toBe("unprocessable");
    expect(errInfo.details).toMatchObject({ reason: "job_payload_erased" });
  });
});
