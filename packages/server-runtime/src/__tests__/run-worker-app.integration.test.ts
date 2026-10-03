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
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInboundMailSupervisor,
  mailAccountsProjectionTable,
} from "@cosmicdrift/kumiko-bundled-features/inbound-mail-foundation";
import {
  createSecretsFeature,
  requireSecretsContext,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createEntity,
  createTextField,
  defineFeature,
  SYSTEM_USER_ID,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createNoopProvider,
  createPrometheusMeter,
} from "@cosmicdrift/kumiko-framework/observability";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { unsafeEnsureEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import { Redis } from "ioredis";
import postgres from "postgres";
import * as z from "zod";
import { makeDispatchSystemWrite } from "../extra-routes-deps.js";
import { runWorkerApp, type WorkerAppHandle } from "../run-worker-app.js";

const bootJobQueuePrefix = `test-worker-boot-${Date.now().toString(36)}`;

const jobRuns: Array<{ note: string; temporalWasDefined: boolean }> = [];

const workerProbeEntity = createEntity({
  fields: { note: createTextField({ personal: false, reason: "test_fixture", required: true }) },
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
    "boot-probe",
    { trigger: { manual: true }, runIn: "worker", runOnBoot: true },
    async () => {},
  );
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
    await unsafePushTables(db, {
      tenant_secrets: tenantSecretsTable,
      read_mail_accounts: mailAccountsProjectionTable,
    });
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

async function pollFor<T>(probe: () => T | undefined): Promise<T> {
  let result: T | undefined;
  await waitFor(
    () => {
      result = probe();
      return result !== undefined;
    },
    { delays: Array(80).fill(100) },
  );
  if (result === undefined) throw new Error("pollFor: timeout");
  return result;
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

  test("wireComponents gets ctx.secrets, so createInboundMailSupervisor can be mounted and stops cleanly", async () => {
    const originalMasterKey = process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
    process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = randomBytes(32).toString("base64");
    let supervisorStopped = false;
    let revealedSecret: string | undefined;
    try {
      const handle = await boot({
        features: [workerProbeFeature, createSecretsFeature()],
        wireComponents: async (deps) => {
          if (!deps.secrets) throw new Error("worker wire deps carry no secrets");
          const providerCtx = {
            registry: deps.registry,
            secrets: deps.secrets,
            _userId: SYSTEM_USER_ID,
          };
          // The path the IMAP provider takes to read an account credential.
          const secrets = requireSecretsContext(providerCtx, "run-worker-app-test");
          await secrets.set(TENANT_ID as TenantId, "worker-test:credential", "imap-password");
          revealedSecret = (
            await secrets.get(TENANT_ID as TenantId, "worker-test:credential")
          )?.reveal();

          const supervisor = createInboundMailSupervisor({
            providerCtx,
            db: deps.db,
            dispatchWrite: ({ handlerQn, payload, tenantId }) =>
              deps.dispatchSystemWrite({ handlerQn, payload, tenantId: tenantId as TenantId }),
          });
          await supervisor.start();
          deps.lifecycle.registerShutdownHook("inbound-mail-supervisor", async () => {
            await supervisor.stop();
            supervisorStopped = true;
          });
        },
      });
      expect(revealedSecret).toBe("imap-password");

      await handle.stop();
      handles = handles.filter((h) => h !== handle);
      expect(supervisorStopped).toBe(true);
    } finally {
      if (originalMasterKey !== undefined) {
        process.env["KUMIKO_SECRETS_MASTER_KEY_V1"] = originalMasterKey;
      } else {
        delete process.env["KUMIKO_SECRETS_MASTER_KEY_V1"];
      }
    }
  });

  test("metrics: the worker serves /metrics on its own port, token-protected, and stops with the worker", async () => {
    const meter = createPrometheusMeter();
    meter.registerMetric({ name: "kumiko_worker_probe_total", type: "counter" });
    meter.counter("kumiko_worker_probe_total").inc(3);

    const handle = await boot({
      observability: { ...createNoopProvider(), meter },
      metrics: { port: 0, token: "scrape-token" },
    });
    const port = handle.metricsServer?.port;
    if (port === undefined) throw new Error("no metrics server started");
    const url = `http://127.0.0.1:${port}/metrics`;

    const ok = await fetch(url, { headers: { Authorization: "Bearer scrape-token" } });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("Content-Type")).toMatch(/openmetrics-text/);
    expect(await ok.text()).toContain("kumiko_worker_probe_total 3");
    expect((await fetch(url)).status).toBe(401);

    await handle.stop();
    handles = handles.filter((h) => h !== handle);
    await expect(
      fetch(url, { headers: { Authorization: "Bearer scrape-token" } }),
    ).rejects.toThrow();
  });

  test("metrics port already in use: the boot rejects before entrypoint.start() consumes anything", async () => {
    const occupier = Bun.serve({ port: 0, fetch: () => new Response("busy") });
    const redis = new Redis(process.env["REDIS_URL"] ?? "redis://localhost:16379");
    try {
      await expect(
        boot({
          jobs: { queueNamePrefix: bootJobQueuePrefix },
          observability: { ...createNoopProvider(), meter: createPrometheusMeter() },
          metrics: { port: occupier.port ?? 0 },
        }),
      ).rejects.toThrow(/in use|EADDRINUSE/i);
      // The queues exist after boot (":meta"), but only start() enqueues the runOnBoot job.
      const keys = await redis.keys(`bull:${bootJobQueuePrefix}*`);
      expect(keys.filter((key) => !key.endsWith(":meta"))).toEqual([]);
    } finally {
      await occupier.stop(true);
      redis.disconnect();
    }
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
