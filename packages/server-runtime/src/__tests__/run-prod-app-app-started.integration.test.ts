// runProdApp records one kumiko:system:app.started event per boot under the
// system tenant. Real Postgres + Redis.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  APP_INSTANCE_STREAM_TYPE,
  APP_STARTED_EVENT_TYPE,
  createArchivedStreamsTable,
  createEventsTable,
  loadAllEventsByType,
} from "@cosmicdrift/kumiko-framework/event-store";
import {
  createEventConsumerStateTable,
  createProjectionStateTable,
} from "@cosmicdrift/kumiko-framework/pipeline";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-types/identifiers";
import postgres from "postgres";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.js";

const TEST_DB = `kumiko_runprod_appstarted_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);

let handle: ProdAppHandle | undefined;

function bootWith(extraEnv: Record<string, string>): Promise<ProdAppHandle> {
  return runProdApp({
    features: [],
    envSource: {
      DATABASE_URL: TEST_DB_URL,
      REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
      JWT_SECRET: "test-runprod-secret-32-chars-min!!",
      PORT: "0",
      ...extraEnv,
    },
    autoListen: false,
    migrations: false,
  });
}

async function loadAppStartedEvents() {
  const { db, close } = createDbConnection(TEST_DB_URL);
  try {
    const events = await loadAllEventsByType(db, APP_INSTANCE_STREAM_TYPE);
    return events.filter((event) => event.type === APP_STARTED_EVENT_TYPE);
  } finally {
    await close();
  }
}

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
  } finally {
    await close();
  }
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
});

afterAll(async () => {
  const adminClient = postgres(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.end();
  }
});

describe("runProdApp app.started event", () => {
  test("each boot appends its own event; a missing version records 'unknown' and still boots", async () => {
    const versionedEnv = {
      KUMIKO_APP_VERSION: "1.2.3",
      KUMIKO_GIT_COMMIT: "abc1234",
      HOSTNAME: "pod-a",
    };
    handle = await bootWith(versionedEnv);
    await handle.stop();
    handle = await bootWith(versionedEnv);
    await handle.stop();

    const versioned = await loadAppStartedEvents();
    expect(versioned).toHaveLength(2);
    expect(new Set(versioned.map((event) => event.aggregateId)).size).toBe(2);
    for (const event of versioned) {
      expect(event.tenantId).toBe(SYSTEM_TENANT_ID);
      expect(event.payload).toMatchObject({
        version: "1.2.3",
        commit: "abc1234",
        instanceId: "pod-a",
        startedAt: expect.any(String),
      });
    }

    handle = await bootWith({ HOSTNAME: "pod-b" });
    const all = await loadAppStartedEvents();
    expect(all).toHaveLength(3);
    const unversioned = all.find((event) => event.payload["instanceId"] === "pod-b");
    expect(unversioned?.payload).toMatchObject({ version: "unknown" });
    expect(unversioned?.payload).not.toHaveProperty("commit");
  });
});
