// Shared apps run behind a per-app Redis ACL user that may only touch `~<P>:*` and `&<P>:*`.
// These tests boot runProdApp against that user with KUMIKO_REDIS_PREFIX=<P> and prove boot,
// write, job, cron and SSE fanout run without NOPERM, that nothing lands outside the prefix, and
// that an unprefixed app keeps today's key layout. The shutdown tests cover the SIGTERM-during-job
// contract (finish the job, take no new ones, give up after the drain budget).

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineEntityCreateHandler,
  defineEntityListHandler,
  defineFeature,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import { composeEnvSchema } from "@cosmicdrift/kumiko-framework/env";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { readSseFrames, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000004" as TenantId;
const TEST_DB = `kumiko_rediskeys_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:16379";
const JWT_SECRET = "test-redis-namespace-secret-32-chars!!";
const ACL_PASSWORD = "namespace-test-pw";

const noAppEnvSchema = composeEnvSchema({ features: [] });

const noteEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  table: "ns_probe_notes",
});

type Gate = {
  readonly started: PromiseWithResolvers<void>;
  readonly release: PromiseWithResolvers<void>;
};

let gate: Gate | undefined;
let heldJobFinished = false;
let extraJobRuns = 0;

function newGate(): Gate {
  return { started: Promise.withResolvers<void>(), release: Promise.withResolvers<void>() };
}

const nsProbeFeature = defineFeature("nsprobe", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(
    defineEntityCreateHandler("note", noteEntity, { access: { roles: ["SystemAdmin"] } }),
  );
  r.queryHandler(
    defineEntityListHandler("note", noteEntity, { access: { roles: ["TenantAdmin"] } }),
  );
  // Sequential: takes the Redis lock held by the runner's lockRedis.
  r.job("held", { trigger: { manual: true }, retries: 0, concurrency: "sequential" }, async () => {
    gate?.started.resolve();
    await gate?.release.promise;
    heldJobFinished = true;
  });
  r.job("extra", { trigger: { manual: true }, retries: 0 }, async () => {
    extraJobRuns += 1;
  });
  r.job("scheduled", { trigger: { cron: "0 0 1 1 *" }, runIn: "worker" }, async () => {});
});

let admin: Redis;
const bootedApps = new Set<ProdAppHandle>();
const createdAclUsers: string[] = [];
const touchedKeyPatterns: string[] = [];
let runCounter = 0;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  admin = new Redis(REDIS_URL);
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.close();
  }
  const { db, close } = createDbConnection({ url: TEST_DB_URL, rowLevelSecurity: "off" });
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafeEnsureEntityTable(db, noteEntity, "note");
  } finally {
    await close();
  }
});

afterEach(async () => {
  gate?.release.resolve();
  gate = undefined;
  for (const app of bootedApps) await app.stop();
  bootedApps.clear();
});

afterAll(async () => {
  for (const user of createdAclUsers) await admin.call("ACL", "DELUSER", user);
  for (const pattern of touchedKeyPatterns) await deleteKeysMatching(pattern);
  admin.disconnect();
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

async function deleteKeysMatching(pattern: string): Promise<void> {
  const keys = await admin.keys(pattern);
  if (keys.length > 0) await admin.del(...keys);
}

function uniqueSuffix(): string {
  runCounter += 1;
  return `${Date.now().toString(36)}${runCounter}`;
}

// The exact rule set documented in docs/reference/infra-requirements.md.
function aclRules(prefix: string): string[] {
  return [
    "on",
    `>${ACL_PASSWORD}`,
    "resetkeys",
    "resetchannels",
    `~${prefix}:*`,
    `&${prefix}:*`,
    "+@all",
    "-@dangerous",
    "+info",
    "+client|setname",
  ];
}

async function createAclUser(prefix: string): Promise<{ name: string; url: string }> {
  const name = `kumiko-acl-${uniqueSuffix()}`;
  await admin.call("ACL", "SETUSER", name, ...aclRules(prefix));
  createdAclUsers.push(name);
  const url = new URL(REDIS_URL);
  url.username = name;
  url.password = ACL_PASSWORD;
  return { name, url: url.toString() };
}

// ACL LOG is how Redis reports a denied command or channel; the app itself only logs it.
async function deniedAttemptsOf(user: string): Promise<string[][]> {
  const log: unknown = await admin.call("ACL", "LOG", "200");
  if (!Array.isArray(log)) return [];
  const denied: string[][] = [];
  for (const entry of log) {
    if (!Array.isArray(entry)) continue;
    const fields = entry.map((item) => String(item));
    if (fields[fields.indexOf("username") + 1] === user) denied.push(fields);
  }
  return denied;
}

function bootEnv(overrides: Record<string, string>): Record<string, string> {
  return { DATABASE_URL: TEST_DB_URL, REDIS_URL, JWT_SECRET, PORT: "0", ...overrides };
}

async function boot(
  envSource: Record<string, string>,
  queueNamePrefix: string,
): Promise<ProdAppHandle> {
  const app = await runProdApp({
    rowLevelSecurity: "off",
    features: [nsProbeFeature],
    envSchema: noAppEnvSchema,
    envSource,
    autoListen: false,
    migrations: false,
    allowPlaintextPii: "test: redis key layout focus, not PII crypto",
    jobs: { queueNamePrefix },
  });
  bootedApps.add(app);
  return app;
}

function dispatchJob(app: ProdAppHandle, jobName: string): Promise<string> {
  if (app.entrypoint.mode !== "all-in-one") throw new Error("expected the all-in-one entrypoint");
  return app.entrypoint.jobRunner.dispatch(`nsprobe:job:${jobName}`, {});
}

async function writeNote(app: ProdAppHandle): Promise<void> {
  const token = await app.entrypoint.jwt.sign({
    id: "writer",
    tenantId: TENANT_ID,
    roles: ["SystemAdmin"],
  });
  const res = await app.entrypoint.app.fetch(
    new Request("http://test/api/write", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type: "nsprobe:write:note:create", payload: { title: "probe" } }),
    }),
  );
  expect(res.status).toBe(200);
}

// Pub/Sub does not buffer for a subscriber whose psubscribe ack has not landed yet, so the write
// repeats until the SSE client has seen a frame.
async function expectSseFrameAfterWrites(app: ProdAppHandle): Promise<void> {
  const token = await app.entrypoint.jwt.sign({
    id: "sse-listener",
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
  const response = await app.entrypoint.app.fetch(
    new Request("http://test/api/sse", { headers: { Authorization: `Bearer ${token}` } }),
  );
  expect(response.status).toBe(200);
  let arrived = false;
  void readSseFrames(response, { until: (frame) => frame.event !== undefined }).then(
    () => {
      arrived = true;
    },
    () => {},
  );
  await waitFor(
    async () => {
      await writeNote(app);
      return arrived;
    },
    { delays: Array(80).fill(100) },
  );
}

function keysBelongingTo(queueNamePrefix: string): Promise<string[]> {
  return admin.keys(`*${queueNamePrefix}*`);
}

describe("runProdApp behind a prefix-scoped Redis ACL user", () => {
  test("boot, write, job, cron and SSE fanout run without NOPERM and stay inside the prefix", async () => {
    const suffix = uniqueSuffix();
    const prefix = `nsacl${suffix}`;
    const queueNamePrefix = `nsq${suffix}`;
    touchedKeyPatterns.push(`${prefix}:*`);
    const acl = await createAclUser(prefix);

    const app = await boot(
      bootEnv({ REDIS_URL: acl.url, KUMIKO_REDIS_PREFIX: prefix }),
      queueNamePrefix,
    );

    gate = newGate();
    await dispatchJob(app, "held");
    await gate.started.promise;
    const lockKeys = await admin.keys(`*kumiko:lock:seq:${queueNamePrefix}:*`);
    expect(lockKeys.length).toBeGreaterThan(0);
    for (const key of lockKeys) expect(key.startsWith(`${prefix}:kumiko:lock:seq:`)).toBe(true);
    gate.release.resolve();
    await waitFor(() => heldJobFinished);

    await expectSseFrameAfterWrites(app);

    const queue = new Queue(`${queueNamePrefix}-worker`, {
      connection: { host: new URL(REDIS_URL).hostname, port: Number(new URL(REDIS_URL).port) },
      prefix: `${prefix}:bull`,
    });
    queue.on("error", () => {});
    try {
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.some((s) => (s.name ?? s.key ?? "").includes("scheduled"))).toBe(true);
    } finally {
      await queue.close();
    }

    const ownKeys = await keysBelongingTo(queueNamePrefix);
    expect(ownKeys.length).toBeGreaterThan(0);
    for (const key of ownKeys) expect(key.startsWith(`${prefix}:`)).toBe(true);
    expect(await deniedAttemptsOf(acl.name)).toEqual([]);
  });
});

describe("runProdApp without a Redis prefix", () => {
  test("keeps the unprefixed key layout", async () => {
    const queueNamePrefix = `nsplain${uniqueSuffix()}`;
    touchedKeyPatterns.push(`*${queueNamePrefix}*`);
    const app = await boot(bootEnv({}), queueNamePrefix);

    gate = newGate();
    await dispatchJob(app, "held");
    await gate.started.promise;
    const keys = await keysBelongingTo(queueNamePrefix);
    const lockKeys = keys.filter((key) => key.startsWith("kumiko:lock:seq:"));
    const bullKeys = keys.filter((key) => key.startsWith(`bull:${queueNamePrefix}-`));
    expect(lockKeys.length).toBeGreaterThan(0);
    expect(bullKeys.length).toBeGreaterThan(0);
    expect(keys.length).toBe(lockKeys.length + bullKeys.length);
    expect(bullKeys).toContain(`bull:${queueNamePrefix}-worker:meta`);
  });
});

describe("runProdApp shutdown with a running job", () => {
  test("stop() waits for the running job and takes no new job", async () => {
    const queueNamePrefix = `nsdrain${uniqueSuffix()}`;
    touchedKeyPatterns.push(`*${queueNamePrefix}*`);
    const app = await boot(bootEnv({ KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS: "20000" }), queueNamePrefix);
    heldJobFinished = false;
    extraJobRuns = 0;
    gate = newGate();
    await dispatchJob(app, "held");
    await gate.started.promise;

    let stopped = false;
    const stopping = app.stop().then(() => {
      stopped = true;
    });
    await waitFor(() => app.entrypoint.lifecycle.state() === "draining");
    await dispatchJob(app, "extra");
    for (let roundTrip = 0; roundTrip < 5; roundTrip += 1) await admin.ping();

    expect(stopped).toBe(false);
    expect(heldJobFinished).toBe(false);
    expect(extraJobRuns).toBe(0);

    gate.release.resolve();
    await stopping;
    expect(heldJobFinished).toBe(true);
    expect(extraJobRuns).toBe(0);
    bootedApps.delete(app);
  });

  test("a job that outlives the configured drain budget does not hold stop() back", async () => {
    const queueNamePrefix = `nsbudget${uniqueSuffix()}`;
    touchedKeyPatterns.push(`*${queueNamePrefix}*`);
    const app = await boot(bootEnv({ KUMIKO_SHUTDOWN_DRAIN_TIMEOUT_MS: "300" }), queueNamePrefix);
    heldJobFinished = false;
    gate = newGate();
    await dispatchJob(app, "held");
    await gate.started.promise;

    await app.stop();

    expect(heldJobFinished).toBe(false);
    bootedApps.delete(app);
    gate.release.resolve();
  });
});
