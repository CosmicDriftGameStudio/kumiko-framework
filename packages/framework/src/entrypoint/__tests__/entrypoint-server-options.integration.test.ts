// runProdApp spreads errorDocs and instanceId into ApiEntrypointOptions. A spread skips the
// excess-property check, so a field missing from that type is dropped without a compile error.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createTestRedis, type TestRedis } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { type BunTestDb, createTestDb } from "../../db/__tests__/query/bun-test-db.ts";
import { createRegistry, defineFeature } from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { SHARED_INSTANCE_SENTINEL } from "../../pipeline/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createApiEntrypoint } from "../index.ts";

const APP_REASON = "order_locked";
const DOCS_BASE_URL = "https://docs.acme.example";
const JWT = "server-options-test-secret-must-be-32-chars!";

const failingFeature = defineFeature("docsdemo", (r) => {
  r.writeHandler({
    name: "fail",
    schema: z.object({}),
    handler: async () => writeFailure(new UnprocessableError(APP_REASON)),
    access: { roles: ["Admin"] },
  });
});

let testDb: BunTestDb;
let testRedis: TestRedis;

beforeAll(async () => {
  [testDb, testRedis] = await Promise.all([createTestDb(), createTestRedis()]);
});

afterAll(async () => {
  await Promise.all([testDb.cleanup(), testRedis.cleanup()]);
});

describe("createApiEntrypoint server options", () => {
  test("errorDocs reaches the server: an app reason links to the app docs", async () => {
    const api = createApiEntrypoint({
      registry: createRegistry([failingFeature]),
      context: { db: testDb.db, redis: testRedis.redis },
      jwtSecret: JWT,
      errorDocs: { baseUrl: DOCS_BASE_URL, reasons: [APP_REASON] },
    });
    try {
      const token = await api.jwt.sign(TestUsers.admin);
      const res = await api.app.request("/api/write", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: "docsdemo:write:fail", payload: {} }),
      });
      expect(await res.json()).toMatchObject({
        error: { docsUrl: `${DOCS_BASE_URL}/errors/${APP_REASON}` },
      });
    } finally {
      await api.stop();
    }
  });

  test("instanceId reaches the server: the reserved sentinel is rejected at boot", () => {
    expect(() =>
      createApiEntrypoint({
        registry: createRegistry([failingFeature]),
        context: { db: testDb.db, redis: testRedis.redis },
        jwtSecret: JWT,
        instanceId: SHARED_INSTANCE_SENTINEL,
      }),
    ).toThrow(/cannot equal the reserved sentinel/);
  });
});
