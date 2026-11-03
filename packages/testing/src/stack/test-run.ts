// @runtime dev
import { randomBytes } from "node:crypto";
import {
  createDbConnection,
  dropDatabaseIfExists,
  listDatabaseNamesWithPrefix,
} from "@cosmicdrift/kumiko-framework/internal/stack-support";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";

// Set by the integration runner; every process of the run shares it, and the runner keeps it alive.
export const TEST_RUN_ID_ENV = "KUMIKO_TEST_RUN_ID";

const TEST_RUN_ALIVE_TTL_SECONDS = 15 * 60;
const TEST_RUN_ALIVE_REFRESH_MS = 60_000;
const SWEEP_SCAN_COUNT = 1000;
const TEST_DATABASE_PREFIX = "kumiko_test_";

// Anchored on the exact run-id width, so legacy `kt:<8 hex>:` keys and hand-named test DBs never match.
const RUN_SCOPED_REDIS_KEY = /^(?:kt:|bull:kt-)([0-9a-f]{12})[:-]/;
const RUN_SCOPED_DATABASE = /^kumiko_test_(?:tpl_)?([0-9a-f]{12})_/;

export function createTestRunId(): string {
  return randomBytes(6).toString("hex");
}

export function runIdOfTestRedisKey(key: string): string | undefined {
  return RUN_SCOPED_REDIS_KEY.exec(key)?.[1];
}

export function runIdOfTestDatabase(dbName: string): string | undefined {
  return RUN_SCOPED_DATABASE.exec(dbName)?.[1];
}

export function testRunAliveKey(runId: string): string {
  return `kt:${runId}:alive`;
}

async function markTestRunAlive(redisUrl: string, runId: string): Promise<void> {
  const Redis = (await import("ioredis")).Redis;
  const redis = new Redis(redisUrl, { lazyConnect: true });
  try {
    await redis.connect();
    await redis.set(testRunAliveKey(runId), "1", "EX", TEST_RUN_ALIVE_TTL_SECONDS);
  } finally {
    redis.disconnect();
  }
}

// A short connection per refresh: a held client would keep the test process from exiting.
export async function keepTestRunAlive(
  redisUrl: string,
  runId: string,
): Promise<{ readonly stop: () => void }> {
  await markTestRunAlive(redisUrl, runId);
  const timer = setInterval(() => {
    markTestRunAlive(redisUrl, runId).catch(() => {
      // skip: the next tick retries, and the TTL outlasts several missed refreshes
    });
  }, TEST_RUN_ALIVE_REFRESH_MS);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}

let processTestRunId: string | undefined;
let processTestRunAlive: Promise<unknown> | undefined;

// Outside the runner (a single `bun test`, dev and e2e servers) the process owns a run of its own.
export function currentTestRunId(): string {
  const runnerRunId = process.env[TEST_RUN_ID_ENV];
  if (runnerRunId !== undefined) return runnerRunId;
  processTestRunId ??= createTestRunId();
  return processTestRunId;
}

// A process-owned run keeps itself alive, so a runner's sweep can tell its keys from a dead run's.
export async function ensureCurrentTestRunAlive(redisUrl: string): Promise<string> {
  const runId = currentTestRunId();
  if (process.env[TEST_RUN_ID_ENV] !== undefined) return runId;
  processTestRunAlive ??= keepTestRunAlive(redisUrl, runId);
  try {
    await processTestRunAlive;
  } catch (error) {
    processTestRunAlive = undefined;
    throw error;
  }
  return runId;
}

// Run-scoped only inside the runner: outside it no Redis key could prove the database is in use.
export function testDatabaseName(): string {
  const runnerRunId = process.env[TEST_RUN_ID_ENV];
  const suffix = generateId().slice(-8);
  return runnerRunId === undefined
    ? `${TEST_DATABASE_PREFIX}${suffix}`
    : `${TEST_DATABASE_PREFIX}${runnerRunId}_${suffix}`;
}

/** Queue-name prefix for a JobRunner a test builds itself (`jobs.queueNamePrefix`,
 *  `createJobRunner`): it sits in the test run's namespace, so the run sweep removes its BullMQ
 *  keys even when the test never cleans them up. BullMQ rejects `:` in `label`. */
export function testRunQueueNamePrefix(label: string): string {
  return `kt-${currentTestRunId()}-${label}-${generateId().slice(-8)}`;
}

export type FinishedTestRunSweep = {
  readonly runId: string;
  readonly redisUrl: string;
  readonly adminDatabaseUrl: string;
};

export type FinishedTestRunSweepResult = {
  readonly redisKeys: number;
  readonly databases: number;
};

type IoRedis = import("ioredis").Redis;

function createRemovableRunCheck(
  redis: IoRedis,
  ownRunId: string,
): (runId: string) => Promise<boolean> {
  const verdicts = new Map<string, boolean>();
  return async (runId) => {
    if (runId === ownRunId) return true;
    const known = verdicts.get(runId);
    if (known !== undefined) return known;
    const removable = (await redis.exists(testRunAliveKey(runId))) === 0;
    verdicts.set(runId, removable);
    return removable;
  };
}

async function sweepTestRunRedisKeys(
  redis: IoRedis,
  isRemovableRun: (runId: string) => Promise<boolean>,
): Promise<number> {
  let removed = 0;
  for (const match of ["kt:*", "bull:kt-*"]) {
    for await (const batch of redis.scanStream({ match, count: SWEEP_SCAN_COUNT })) {
      const keys: string[] = [];
      for (const key of batch) {
        const runId = runIdOfTestRedisKey(key);
        if (runId !== undefined && (await isRemovableRun(runId))) keys.push(key);
      }
      if (keys.length > 0) removed += await redis.unlink(...keys);
    }
  }
  return removed;
}

async function sweepTestRunDatabases(
  adminUrl: string,
  isRemovableRun: (runId: string) => Promise<boolean>,
): Promise<number> {
  const admin = createDbConnection({ url: adminUrl, maxConnections: 1, rowLevelSecurity: "off" });
  let dropped = 0;
  try {
    for (const dbName of await listDatabaseNamesWithPrefix(admin.db, TEST_DATABASE_PREFIX)) {
      const runId = runIdOfTestDatabase(dbName);
      if (runId === undefined || !(await isRemovableRun(runId))) continue;
      try {
        await dropDatabaseIfExists(admin.db, dbName);
        dropped += 1;
      } catch {
        // skip: a database with open connections is still in use; a later sweep retries it
      }
    }
  } finally {
    await admin.close();
  }
  return dropped;
}

// Once per run: removes what the run itself left behind, plus whatever runs without a live
// alive key (killed or crashed) left in Redis and Postgres.
export async function sweepFinishedTestRuns(
  sweep: FinishedTestRunSweep,
): Promise<FinishedTestRunSweepResult> {
  const Redis = (await import("ioredis")).Redis;
  const redis = new Redis(sweep.redisUrl, { lazyConnect: true });
  try {
    await redis.connect();
    const isRemovableRun = createRemovableRunCheck(redis, sweep.runId);
    const redisKeys = await sweepTestRunRedisKeys(redis, isRemovableRun);
    const databases = await sweepTestRunDatabases(sweep.adminDatabaseUrl, isRemovableRun);
    return { redisKeys, databases };
  } finally {
    redis.disconnect();
  }
}
