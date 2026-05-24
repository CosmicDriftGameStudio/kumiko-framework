// Integration test for the rate-limiting feature: proves the status
// query handler is registered, accessible to admins, and reports the
// real bucket state from the framework's RateLimitResolver.
//
// L3 dispatcher hook + resolver wiring are tested in framework-side
// suites; here we only verify the feature's own surface area.

import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack, TestUsers } from "@cosmicdrift/kumiko-framework/stack";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { createRateLimitingFeature } from "../feature";

let stack: TestStack;
const admin = TestUsers.admin;

// Helper handler with a tight rate limit so we can drain the bucket
// fast enough for the status query to observe a non-trivial state.
const probeFeature = defineFeature("rl-probe", (r) => {
  r.queryHandler("ping", z.object({}), async () => ({ ok: true }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "user", limit: 5, windowSeconds: 60 },
  });
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [createRateLimitingFeature(), probeFeature],
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

describe("rate-limiting feature — status query", () => {
  test("reports a fresh bucket as fully available before any traffic", async () => {
    const status = await stack.http.queryOk<{
      bucket: string;
      limit: number;
      remaining: number;
      windowSeconds: number;
    }>(
      "rate-limiting:query:status",
      { bucket: `user:${admin.id}`, limit: 5, windowSeconds: 60 },
      admin,
    );
    expect(status.bucket).toBe(`user:${admin.id}`);
    expect(status.limit).toBe(5);
    expect(status.remaining).toBe(5);
    expect(status.windowSeconds).toBe(60);
  });

  test("reports the deducted remaining tokens after real handler traffic", async () => {
    // Drain the bucket via the probe handler — same per/limit/window
    // as the status query peeks below, so the buckets line up.
    for (let i = 0; i < 3; i++) {
      await stack.http.queryOk("rl-probe:query:ping", {}, admin);
    }

    const status = await stack.http.queryOk<{ remaining: number }>(
      "rate-limiting:query:status",
      { bucket: `user:${admin.id}`, limit: 5, windowSeconds: 60 },
      admin,
    );
    // 3 deductions of cost-1 → 2 tokens left.
    expect(status.remaining).toBe(2);
  });

  test("status access requires Admin/SystemAdmin", async () => {
    const guest = TestUsers.user;
    const res = await stack.http.query(
      "rate-limiting:query:status",
      { bucket: "user:0", limit: 1, windowSeconds: 60 },
      guest,
    );
    // Access-denied surfaces as 403 in the dispatcher's outer wrapper.
    expect(res.status).toBe(403);
  });
});
