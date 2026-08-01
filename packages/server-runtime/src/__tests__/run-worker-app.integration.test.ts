// runWorkerApp integration: boots the dedicated worker process against
// real Postgres + Redis. Proves:
//   - ensureTemporalPolyfill ran BEFORE the job executed (fw#1725: the
//     bug that cost real time — without the polyfill, every job in the
//     worker fails with "Temporal is not defined")
//   - event-triggered jobs run end-to-end (afterCommit → BullMQ → handler)
//   - the schema-drift gate aborts the boot on pending migrations
//   - wireComponents gets db/redis/registry/dispatchSystemWrite/lifecycle
//     and can register its own shutdown hooks

import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import { createEntity, createTextField, defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable } from "@cosmicdrift/kumiko-framework/stack";
import postgres from "postgres";
import { z } from "zod";
import { makeDispatchSystemWrite } from "../extra-routes-deps";
import { runWorkerApp, type WorkerAppHandle } from "../run-worker-app";

const jobRuns: Array<{ note: string; temporalWasDefined: boolean }> = [];

const workerProbeEntity = createEntity({
  fields: { note: createTextField({ required: true }) },
  table: "worker_probes",
});

const workerProbeFeature = defineFeature("worker-probe", (r) => {
  r.entity("probe", workerProbeEntity);
  r.writeHandler({
    name: "ping",
    schema: z.object({ note: z.string() }),
    access: { roles: ["SystemAdmin"] },
    handler: async (event) => ({
      isSuccess: true as const,
      data: { note: (event.payload as { note: string }).note },
    }),
  });
  // The job's only purpose: prove Temporal is already defined by the time
  // the handler runs. Before fw#1725 there was no framework-side boot
  // path for this — apps had to rebuild the polyfill call by hand
  // (solon#42) and forgot it.
  r.job(
    "record-ping",
    { trigger: { on: "worker-probe:write:ping" }, runIn: "worker" },
    async (payload) => {
      const temporalWasDefined =
        typeof (globalThis as { Temporal?: unknown }).Temporal === "object";
      // Touches the global directly — throws "Temporal is not defined" if the
      // polyfill never ran, which is the exact failure mode fw#1725 reports.
      Temporal.Now.instant();
      jobRuns.push({
        note: (payload as { note: string }).note,
        temporalWasDefined,
      });
    },
  );
});

const TENANT_ID = "00000000-0000-4000-8000-000000000002";
const TEST_DB = `kumiko_runworker_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";

const tempDirs: string[] = [];
let handles: WorkerAppHandle[] = [];

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.end();
  }
  const url = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  const { db, close } = createDbConnection(url);
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafeEnsureEntityTable(db, workerProbeEntity, "probe");
  } finally {
    await close();
  }
});

afterEach(async () => {
  for (const handle of handles) {
    await handle.stop();
  }
  handles = [];
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
  tempDirs.length = 0;
  jobRuns.length = 0;
});

async function boot(extra?: Partial<Parameters<typeof runWorkerApp>[0]>): Promise<WorkerAppHandle> {
  const originalDbUrl = process.env["DATABASE_URL"];
  process.env["DATABASE_URL"] = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
  process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:16379";
  process.env["JWT_SECRET"] = "test-runworker-secret-32-chars-min!!";
  try {
    const handle = await runWorkerApp({
      features: [workerProbeFeature],
      migrations: false,
      jobs: { queueNamePrefix: `test-worker-${Date.now().toString(36)}` },
      ...(extra ?? {}),
    });
    handles.push(handle);
    return handle;
  } finally {
    if (originalDbUrl !== undefined) process.env["DATABASE_URL"] = originalDbUrl;
    else delete process.env["DATABASE_URL"];
  }
}

async function pollFor<T>(probe: () => T | undefined, timeoutMs = 8000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = probe();
    if (result !== undefined) return result;
    if (Date.now() > deadline) throw new Error("pollFor: timeout");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

describe("runWorkerApp", () => {
  test("boots against real Postgres/Redis — mode is worker, dispatcher available", async () => {
    const handle = await boot();
    expect(handle.entrypoint.mode).toBe("worker");
    expect(handle.entrypoint.dispatcher).toBeDefined();
  });

  test("event-triggered job runs end-to-end with Temporal already defined (fw#1725 regression)", async () => {
    const handle = await boot();
    const dispatchSystemWrite = makeDispatchSystemWrite(handle.entrypoint.dispatcher);

    const result = await dispatchSystemWrite({
      handlerQn: "worker-probe:write:ping",
      payload: { note: "hello-from-worker" },
      tenantId: TENANT_ID as import("@cosmicdrift/kumiko-framework/engine").TenantId,
    });
    expect(result.isSuccess).toBe(true);

    const run = await pollFor(() => jobRuns.find((r) => r.note === "hello-from-worker"));
    expect(run.temporalWasDefined).toBe(true);
  });

  test("wireComponents receives db/redis/registry/dispatchSystemWrite/lifecycle and can register a shutdown hook", async () => {
    let seenDeps: {
      db: boolean;
      redis: boolean;
      registry: boolean;
      dispatchSystemWrite: boolean;
    } | null = null;
    let shutdownHookRan = false;

    const handle = await boot({
      wireComponents: async (deps) => {
        seenDeps = {
          db: deps.db !== undefined,
          redis: deps.redis !== undefined,
          registry: deps.registry.features.has("worker-probe"),
          dispatchSystemWrite: typeof deps.dispatchSystemWrite === "function",
        };
        deps.lifecycle.registerShutdownHook("test-component", async () => {
          shutdownHookRan = true;
        });
      },
    });

    expect(seenDeps!).toEqual({
      db: true,
      redis: true,
      registry: true,
      dispatchSystemWrite: true,
    });

    await handle.stop();
    handles = handles.filter((h) => h !== handle);
    expect(shutdownHookRan).toBe(true);
  });

  test("Schema-Drift-Gate: pending migration aborts the boot before anything else initializes", async () => {
    const driftDir = await mkdtemp(join(tmpdir(), "kumiko-worker-drift-boot-"));
    tempDirs.push(driftDir);
    await writeFile(
      join(driftDir, "0001_pending.sql"),
      `CREATE TABLE "worker_never_created_table" ("id" uuid PRIMARY KEY);`,
    );
    await writeFile(
      join(driftDir, ".snapshot.json"),
      JSON.stringify({
        version: 1,
        tables: [{ tableName: "worker_never_created_table", columns: [] }],
      }),
    );

    await expect(boot({ migrations: { dir: driftDir } })).rejects.toThrow(/Schema drift detected/);
  });
});
