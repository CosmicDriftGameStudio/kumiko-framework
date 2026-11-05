// A job running in the worker process triggers an `unsubscribe: true` notification: the worker
// signs the link only when it got the `unsubscribe` option, like runProdApp does for the API.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import {
  configValuesTable,
  createConfigFeature,
} from "@cosmicdrift/kumiko-bundled-features/config";
import {
  type ChannelMessage,
  createDeliveryFeature,
  DELIVERY_CHANNEL_EXTENSION,
  deliveryAttemptsTable,
  notificationAddressOptOutsTable,
  notificationPreferencesTable,
} from "@cosmicdrift/kumiko-bundled-features/delivery";
import {
  createTenantFeature,
  tenantEntity,
  tenantMembershipsTable,
} from "@cosmicdrift/kumiko-bundled-features/tenant";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  defineFeature,
  defineWriteHandler,
  type NotifyFn,
  type TenantId,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  createArchivedStreamsTable,
  createEventsTable,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { waitFor } from "@cosmicdrift/kumiko-testing/helpers";
import {
  testRunQueueNamePrefix,
  unsafeEnsureEntityTable,
  unsafePushTables,
} from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { makeDispatchSystemWrite } from "../extra-routes-deps.ts";
import { runWorkerApp, type WorkerAppHandle } from "../run-worker-app.ts";

const TENANT_ID = "00000000-0000-4000-8000-000000000003" as TenantId;
const TEST_DB = `kumiko_runworker_unsub_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const APP_ORIGIN = "https://app.example";
const UNSUBSCRIBE_SECRET = randomBytes(32).toString("hex");

const sentMessages: ChannelMessage[] = [];

const captureEmailChannelFeature = defineFeature("channel-email", (r) => {
  r.requires({ features: ["delivery"] });
  r.useExtension(DELIVERY_CHANNEL_EXTENSION, "email", {
    mode: "inline",
    send: async (address, message) => {
      sentMessages.push(message);
      return { status: "sent", address };
    },
  });
});

const digestFeature = defineFeature("digest-probe", (r) => {
  r.requires({ features: ["delivery"] });
  r.notification("digest", { unsubscribe: true });
  r.writeHandler(
    defineWriteHandler({
      name: "trigger",
      schema: z.object({}),
      access: { roles: ["SystemAdmin"] },
      handler: async () => ({ isSuccess: true as const, data: {} }),
    }),
  );
  r.job(
    "send-digest",
    { trigger: { on: "digest-probe:write:trigger" }, runIn: "worker" },
    async (_payload, ctx) => {
      const notify = ctx.notify as NotifyFn;
      await notify("digest-probe:notify:digest", {
        route: { email: "reader@external.test" },
        data: { title: "Digest" },
        immediate: true,
      });
    },
  );
});

let handles: WorkerAppHandle[] = [];

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
    await unsafeEnsureEntityTable(db, tenantEntity, "tenant");
    await unsafePushTables(db, {
      configValuesTable,
      tenantMembershipsTable,
      deliveryAttemptsTable,
      notificationAddressOptOutsTable,
      notificationPreferencesTable,
    });
  } finally {
    await close();
  }
});

afterEach(async () => {
  for (const handle of handles) await handle.stop();
  handles = [];
  sentMessages.length = 0;
});

afterAll(async () => {
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

async function runDigestJobInWorker(
  extra: Partial<Parameters<typeof runWorkerApp>[0]>,
): Promise<ChannelMessage> {
  const handle = await runWorkerApp({
    rowLevelSecurity: "off",
    features: [
      createConfigFeature(),
      createTenantFeature(),
      createDeliveryFeature(),
      captureEmailChannelFeature,
      digestFeature,
    ],
    migrations: false,
    blindIndexKey: randomBytes(32).toString("base64"),
    allowPlaintextPii: "test: unsubscribe wiring focus, not PII crypto",
    jobs: { queueNamePrefix: testRunQueueNamePrefix("test-worker-unsub") },
    envSource: {
      DATABASE_URL: TEST_DB_URL,
      REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
      JWT_SECRET: "test-runworker-secret-32-chars-min!!",
      APP_BASE_URL: APP_ORIGIN,
    },
    ...extra,
  });
  handles.push(handle);
  const result = await makeDispatchSystemWrite(handle.entrypoint.dispatcher)({
    handlerQn: "digest-probe:write:trigger",
    payload: {},
    tenantId: TENANT_ID,
  });
  expect(result.isSuccess).toBe(true);
  await waitFor(() => sentMessages.length > 0, { delays: Array(80).fill(100) });
  const [message] = sentMessages;
  if (message === undefined) throw new Error("the digest job sent no mail");
  return message;
}

describe("runWorkerApp unsubscribe option", () => {
  test("a job's unsubscribe: true mail carries a signed link when the worker got the option", async () => {
    const message = await runDigestJobInWorker({ unsubscribe: { secret: UNSUBSCRIBE_SECRET } });
    expect(message.data?.["unsubscribeUrl"]).toEqual(
      expect.stringContaining(`${APP_ORIGIN}/api/delivery/unsubscribe?token=`),
    );
  });

  test("without the option the mail carries no unsubscribe link", async () => {
    const message = await runDigestJobInWorker({});
    expect(message.data?.["unsubscribeUrl"]).toBeUndefined();
  });
});
