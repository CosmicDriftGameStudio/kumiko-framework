import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { setupTestStack, type TestStack, TestUsers } from "../index.js";

const limitedFeature = defineFeature("shared-redis-test", (r) => {
  r.queryHandler("ping", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 2, windowSeconds: 60 },
  });
});

const admin = TestUsers.admin;

describe("setupTestStack sharedRedisWith", () => {
  let owner: TestStack;
  let borrower: TestStack;
  let unrelated: TestStack;

  beforeAll(async () => {
    owner = await setupTestStack({ features: [limitedFeature] });
    borrower = await setupTestStack({ features: [limitedFeature], sharedRedisWith: owner });
    unrelated = await setupTestStack({ features: [limitedFeature] });
  });

  afterAll(async () => {
    await unrelated.cleanup();
    await borrower.cleanup();
    await owner.cleanup();
  });

  test("borrower reuses the owner's keyPrefix on its own connection", () => {
    expect(borrower.redis.keyPrefix).toBe(owner.redis.keyPrefix);
    expect(borrower.redis.redis).not.toBe(owner.redis.redis);
  });

  test("rate-limit bucket filled via the owner blocks the borrower", async () => {
    await owner.http.queryOk("shared-redis-test:query:ping", {}, admin);
    await owner.http.queryOk("shared-redis-test:query:ping", {}, admin);

    const res = await borrower.http.query("shared-redis-test:query:ping", {}, admin);
    expect(res.status).toBe(429);
  });

  test("a stack without sharedRedisWith keeps its own, untouched bucket", async () => {
    const res = await unrelated.http.query("shared-redis-test:query:ping", {}, admin);
    expect(res.status).toBe(200);
  });
});
