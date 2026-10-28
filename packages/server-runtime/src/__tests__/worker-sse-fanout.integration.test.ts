// A dedicated worker runs the SSE-broadcast consumer, so its signals must cross Redis to the
// SSE clients of the API process. The API and the worker are two separately booted apps that
// share Postgres + Redis, like the two deployments in production.

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
import { readSseFrames, type SseFrame, waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-testing/stack";
import { makeDispatchSystemWrite } from "../extra-routes-deps.ts";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";
import { runWorkerApp, type WorkerAppHandle } from "../run-worker-app.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000003" as TenantId;
const TEST_DB = `kumiko_workersse_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const REDIS_URL = process.env["REDIS_URL"] ?? "redis://localhost:16379";
const JWT_SECRET = "test-worker-sse-secret-32-chars-min!!";

const noAppEnvSchema = composeEnvSchema({ features: [] });

const noteEntity = createEntity({
  fields: { title: createTextField({ personal: false, reason: "test_fixture", required: true }) },
  table: "sse_probe_notes",
});

const sseProbeFeature = defineFeature("sse-probe", (r) => {
  r.entity({ name: "note", ...noteEntity });
  r.writeHandler(
    defineEntityCreateHandler("note", noteEntity, { access: { roles: ["SystemAdmin"] } }),
  );
  r.queryHandler(
    defineEntityListHandler("note", noteEntity, { access: { roles: ["TenantAdmin"] } }),
  );
});

let api: ProdAppHandle | undefined;
let worker: WorkerAppHandle | undefined;
let uniqueRun = 0;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
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
  await worker?.stop();
  worker = undefined;
  await api?.stop();
  api = undefined;
});

afterAll(async () => {
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

function envWithOwnChannelPrefix(label: string): Record<string, string> {
  uniqueRun += 1;
  return {
    DATABASE_URL: TEST_DB_URL,
    REDIS_URL,
    JWT_SECRET,
    PORT: "0",
    KUMIKO_REDIS_CHANNEL_PREFIX: `${label}-${Date.now().toString(36)}-${uniqueRun}`,
  };
}

async function bootApi(env: Record<string, string>): Promise<ProdAppHandle> {
  const booted = await runProdApp({
    rowLevelSecurity: "off",
    features: [sseProbeFeature],
    envSchema: noAppEnvSchema,
    envSource: env,
    autoListen: false,
    migrations: false,
    runSingleInstance: false,
    allowPlaintextPii: "test: SSE fanout focus, not PII crypto",
    jobs: { queueNamePrefix: `test-worker-sse-api-${Date.now().toString(36)}` },
  });
  api = booted;
  return booted;
}

async function bootWorker(
  options: Pick<Parameters<typeof runWorkerApp>[0], "envSource">,
): Promise<WorkerAppHandle> {
  const booted = await runWorkerApp({
    rowLevelSecurity: "off",
    features: [sseProbeFeature],
    migrations: false,
    jobs: { queueNamePrefix: `test-worker-sse-${Date.now().toString(36)}` },
    ...options,
  });
  worker = booted;
  return booted;
}

type SseOutcome = { frames: SseFrame[] } | { error: unknown } | undefined;

async function openSseOnApi(app: ProdAppHandle): Promise<() => SseOutcome> {
  const token = await app.entrypoint.jwt.sign({
    id: "sse-listener",
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
  const response = await app.entrypoint.app.fetch(
    new Request("http://test/api/sse", { headers: { Authorization: `Bearer ${token}` } }),
  );
  expect(response.status).toBe(200);
  let outcome: SseOutcome;
  void readSseFrames(response, {
    until: (frame) => frame.event !== undefined,
  }).then(
    (frames) => {
      outcome = { frames };
    },
    (error: unknown) => {
      outcome = { error };
    },
  );
  return () => outcome;
}

async function createNoteOnWorker(handle: WorkerAppHandle): Promise<void> {
  const result = await makeDispatchSystemWrite(handle.entrypoint.dispatcher)({
    handlerQn: "sse-probe:write:note:create",
    payload: { title: "written by the worker" },
    tenantId: TENANT_ID,
  });
  expect(result.isSuccess).toBe(true);
}

// Pub/Sub does not buffer for a subscriber whose psubscribe ack has not landed yet, so the
// worker write repeats until the API client has seen a frame.
async function expectFrameOnApiClient(
  arrival: () => SseOutcome,
  handle: WorkerAppHandle,
): Promise<void> {
  await waitFor(
    async () => {
      await createNoteOnWorker(handle);
      return arrival() !== undefined;
    },
    { delays: Array(80).fill(100) },
  );
  const outcome = arrival();
  if (outcome === undefined || !("frames" in outcome)) {
    throw new Error(
      `no SSE frame reached the API client: ${String(outcome && "error" in outcome ? outcome.error : "")}`,
    );
  }
  expect(outcome.frames.length).toBeGreaterThan(0);
}

describe("worker -> API SSE fanout over Redis", () => {
  test("worker env from process.env: a worker write reaches an SSE client on the API process", async () => {
    const env = envWithOwnChannelPrefix("worker-sse-process-env");
    const previous = { ...process.env };
    Object.assign(process.env, env);
    try {
      const apiApp = await bootApi(env);
      const workerApp = await bootWorker({});
      const arrival = await openSseOnApi(apiApp);
      await expectFrameOnApiClient(arrival, workerApp);
    } finally {
      for (const key of Object.keys(env)) {
        const before = previous[key];
        if (before === undefined) delete process.env[key];
        else process.env[key] = before;
      }
    }
  });

  test("worker env only via envSource: a worker write reaches an SSE client on the API process", async () => {
    const env = envWithOwnChannelPrefix("worker-sse-env-source");
    const apiApp = await bootApi(env);
    const workerApp = await bootWorker({ envSource: env });
    const arrival = await openSseOnApi(apiApp);
    await expectFrameOnApiClient(arrival, workerApp);
  });
});
