// Seeds are bootstrap writes: a handler's `rateLimit` must neither fail them nor drain the bucket
// that real requests use. Real Postgres + Redis; the request side goes through the real /api/write.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { createDbConnection } from "@cosmicdrift/kumiko-framework/db";
import {
  createSystemUser,
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
import * as z from "zod";
import { type ProdAppHandle, runProdApp } from "../run-prod-app.ts";

const noAppEnvSchema = composeEnvSchema({ features: [] });

const TENANT_ID = "00000000-0000-4000-8000-000000000001" as TenantId;
const TEST_DB = `kumiko_runprod_seedratelimit_${Date.now().toString(36)}`;
const ADMIN_URL = process.env["TEST_DATABASE_URL"] ?? "";
const TEST_DB_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${TEST_DB}`);
const PING = "limited:write:ping";
const SEED_CALLS = 3;

const limitedFeature = defineFeature("limited", (r) => {
  r.writeHandler({
    name: "ping",
    schema: z.object({}),
    access: { roles: ["SystemAdmin", "User"] },
    rateLimit: { per: "user", limit: 1, windowSeconds: 3600 },
    handler: async () => ({ isSuccess: true as const, data: { pong: true } }),
  });
});

let handle: ProdAppHandle | undefined;

beforeAll(async () => {
  if (!ADMIN_URL) throw new Error("TEST_DATABASE_URL must be set");
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`CREATE DATABASE "${TEST_DB}"`);
  } finally {
    await adminClient.close();
  }
  const { db, close } = createDbConnection({ url: TEST_DB_URL });
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
  const adminClient = new Bun.SQL(ADMIN_URL.replace(/\/[^/]+$/, "/postgres"));
  try {
    await adminClient.unsafe(`DROP DATABASE IF EXISTS "${TEST_DB}" WITH (FORCE)`);
  } finally {
    await adminClient.close();
  }
});

describe("runProdApp seeds and rateLimit", () => {
  test("a seed may call a rate-limited handler above its limit, a request is still limited", async () => {
    const seedResults: boolean[] = [];
    // One identity for seed and request: both would share the "per: user" bucket if the seed were limited.
    const seedUser = createSystemUser(TENANT_ID, ["SystemAdmin"]);

    handle = await runProdApp({
      features: [limitedFeature],
      envSource: {
        DATABASE_URL: TEST_DB_URL,
        REDIS_URL: process.env["REDIS_URL"] ?? "redis://localhost:16379",
        JWT_SECRET: "test-runprod-secret-32-chars-min!!",
        PORT: "0",
      },
      envSchema: noAppEnvSchema,
      autoListen: false,
      migrations: false,
      seeds: [
        async ({ dispatcher }) => {
          for (let call = 0; call < SEED_CALLS; call++) {
            const result = await dispatcher.write(PING, {}, seedUser);
            seedResults.push(result.isSuccess);
          }
        },
      ],
    });

    expect(seedResults).toEqual([true, true, true]);

    const token = await handle.entrypoint.jwt.sign({
      id: `rate-limit-reader-${Date.now().toString(36)}`,
      tenantId: TENANT_ID,
      roles: ["User"],
    });
    const { app } = handle.entrypoint;
    const callPing = async (): Promise<Response> =>
      app.fetch(
        new Request("http://test/api/write", {
          method: "POST",
          headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ type: PING, payload: {} }),
        }),
      );

    expect((await callPing()).status).toBe(200);
    expect((await callPing()).status).toBe(429);
  });
});
