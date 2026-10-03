// runProdApp wires ctx.notify to the delivery job pipeline and to the tenant
// secrets: a chat channel addressed via `route` reaches its (local) provider
// stub without any app-side wiring. Real Postgres + Redis, real BullMQ worker,
// real /api/write calls.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createChannelSlackFeature } from "@cosmicdrift/kumiko-bundled-features/channel-slack";
import { createChannelTelegramFeature } from "@cosmicdrift/kumiko-bundled-features/channel-telegram";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  createDeliveryFeature,
  deliveryAttemptsTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  createSecretsFeature,
  tenantSecretsTable,
} from "@cosmicdrift/kumiko-bundled-features/secrets";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { selectMany } from "@cosmicdrift/kumiko-framework/bun-db";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  type NotifyOptions,
  type NotifyResult,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
  getStreamVersion,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { unsafeEnsureEntityTable, unsafePushTables } from "@cosmicdrift/kumiko-framework/stack";
import { waitFor } from "@cosmicdrift/kumiko-framework/testing";
import postgres from "postgres";
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_delivery_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

const OPS_NOTIFICATION = "ops:notify:announcement";

// Chat provider stand-in: resolves `firstRequest` on the first POST.
function startStub(): {
  readonly origin: string;
  readonly paths: string[];
  readonly firstRequest: Promise<void>;
  stop(): void;
} {
  const paths: string[] = [];
  let resolveFirst: () => void = () => {};
  const firstRequest = new Promise<void>((resolve) => {
    resolveFirst = resolve;
  });
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      await req.text();
      paths.push(new URL(req.url).pathname);
      resolveFirst();
      return new Response("ok");
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    paths,
    firstRequest,
    stop: () => {
      server.stop(true);
    },
  };
}

const opsFeature = defineFeature("ops", (r) => {
  r.requires("delivery");
  r.writeHandler(
    defineWriteHandler({
      name: "announce",
      schema: z.object({
        route: z.record(z.string(), z.string()),
        immediate: z.boolean().optional(),
      }),
      access: { roles: ["TenantAdmin"] },
      handler: async (event, ctx) => {
        const notify = ctx.notify as NotifyFn;
        const options: NotifyOptions = {
          route: event.payload.route,
          data: { title: "Deploy done" },
          ...(event.payload.immediate && { immediate: true }),
        };
        const result: NotifyResult = await notify(OPS_NOTIFICATION, options);
        return { isSuccess: true as const, data: { deliveries: result.deliveries } };
      },
    }),
  );
});

type AnnounceDelivery = {
  channel: string;
  status: string;
  error: string | null;
  deliveryAttemptId?: string;
};

let stub: ReturnType<typeof startStub>;
let handle: ProdAppHandle | undefined;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.end();
  }
  const { db, close } = createDbConnection(TEST_DB_URL);
  try {
    await createEventsTable(db);
    await createArchivedStreamsTable(db);
    await createProjectionStateTable(db);
    await createEventConsumerStateTable(db);
    await unsafePushTables(db, {
      configValuesTable,
      tenantMembershipsTable,
      tenant_secrets: tenantSecretsTable,
      store_delivery_attempts: deliveryAttemptsTable,
    });
    await unsafeEnsureEntityTable(db, tenantEntity, "tenant");
  } finally {
    await close();
  }
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  stub?.stop();
});

afterAll(async () => {
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.end();
  }
});

async function bootWithChatChannels(): Promise<ProdAppHandle> {
  stub = startStub();
  process.env["DATABASE_URL"] = TEST_DB_URL;
  process.env["REDIS_URL"] = process.env["REDIS_URL"] ?? "redis://localhost:16379";
  process.env["JWT_SECRET"] = "test-runprod-secret-32-chars-min!!";
  process.env["PORT"] = "0";
  const booted = await runProdApp({
    features: [
      createConfigFeature(),
      createSecretsFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      createChannelSlackFeature({ allowedHosts: ["127.0.0.1"], requireHttps: false }),
      createChannelTelegramFeature({
        apiBaseUrl: stub.origin,
        allowedHosts: ["127.0.0.1"],
        requireHttps: false,
      }),
      opsFeature,
    ],
    autoListen: false,
    migrations: false,
    allowPlaintextPii: "test: chat delivery wiring, not crypto",
    masterKey: createEnvMasterKeyProvider({
      env: {
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      },
    }),
    jobs: { queueNamePrefix: `test-delivery-${Date.now().toString(36)}` },
  });
  handle = booted;
  return booted;
}

async function writeAsTenantAdmin(
  app: ProdAppHandle,
  type: string,
  payload: Record<string, unknown>,
): Promise<{ readonly status: number; readonly body: { data?: unknown } }> {
  const token = await app.entrypoint.jwt.sign({
    id: "tenant-admin",
    tenantId: TENANT_ID,
    roles: ["TenantAdmin"],
  });
  const res = await app.entrypoint.app.fetch(
    new Request("http://test/api/write", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ type, payload }),
    }),
  );
  return { status: res.status, body: (await res.json()) as { data?: unknown } };
}

async function announce(
  app: ProdAppHandle,
  route: Record<string, string>,
  immediate = false,
): Promise<AnnounceDelivery[]> {
  const { status, body } = await writeAsTenantAdmin(app, "ops:write:announce", {
    route,
    ...(immediate && { immediate: true }),
  });
  expect(status).toBe(200);
  return (body.data as { deliveries: AnnounceDelivery[] }).deliveries;
}

async function attemptRow(
  attemptId: string,
): Promise<{ status: string; error: string | null } | undefined> {
  const { db, close } = createDbConnection(TEST_DB_URL);
  try {
    const rows = await selectMany<{ status: string; error: string | null }>(
      db,
      deliveryAttemptsTable,
      { id: attemptId },
    );
    return rows[0];
  } finally {
    await close();
  }
}

async function attemptEventCount(attemptId: string): Promise<number> {
  const { db, close } = createDbConnection(TEST_DB_URL);
  try {
    return await getStreamVersion(db, attemptId, TENANT_ID);
  } finally {
    await close();
  }
}

describe("runProdApp: chat channels deliver without app wiring", () => {
  test("slack: ctx.notify(route) queues, the delivery job posts to the stub exactly once", async () => {
    const app = await bootWithChatChannels();
    const set = await writeAsTenantAdmin(app, "secrets:write:set", {
      key: "channel-slack:webhooks.ops",
      value: `${stub.origin}/slack-hook`,
    });
    expect(set.status).toBe(200);

    const deliveries = await announce(app, { slack: "ops" });

    expect(deliveries).toHaveLength(1);
    const [delivery] = deliveries;
    expect(delivery?.channel).toBe("slack");
    expect(delivery?.status).toBe("queued");
    const attemptId = delivery?.deliveryAttemptId ?? "";
    expect(attemptId).not.toBe("");

    await stub.firstRequest;
    await waitFor(async () => (await attemptRow(attemptId))?.status === "sent");

    expect(stub.paths).toEqual(["/slack-hook"]);
    expect(await attemptEventCount(attemptId)).toBe(2);
  });

  test("telegram: bot token secret resolves in the job, no missing_credentials", async () => {
    const app = await bootWithChatChannels();
    const set = await writeAsTenantAdmin(app, "secrets:write:set", {
      key: "channel-telegram:secret:bot-token",
      value: "123:TESTTOKEN-0123456789",
    });
    expect(set.status).toBe(200);

    const [delivery] = await announce(app, { telegram: "424242" });
    expect(delivery?.status).toBe("queued");
    const attemptId = delivery?.deliveryAttemptId ?? "";

    await stub.firstRequest;
    await waitFor(async () => (await attemptRow(attemptId))?.status === "sent");
    expect((await attemptRow(attemptId))?.error).toBeNull();
    expect(stub.paths).toHaveLength(1);
  });

  test("immediate: delivers inline with the tenant secret and reports sent", async () => {
    const app = await bootWithChatChannels();
    await writeAsTenantAdmin(app, "secrets:write:set", {
      key: "channel-slack:webhooks.ops",
      value: `${stub.origin}/slack-hook`,
    });

    const [delivery] = await announce(app, { slack: "ops" }, true);

    expect(delivery?.status).toBe("sent");
    expect(stub.paths).toEqual(["/slack-hook"]);
  });

  test("immediate without a stored secret reports failed + missing_credentials", async () => {
    const app = await bootWithChatChannels();

    const [delivery] = await announce(app, { slack: "unconfigured" }, true);

    expect(delivery?.status).toBe("failed");
    expect(delivery?.error).toBe("missing_credentials");
    expect(stub.paths).toHaveLength(0);
  });
});
