// Integration test for the rate-limiting feature: proves the status
// query handler is registered, accessible to admins, and reports the
// real bucket state from the framework's RateLimitResolver.
//
// L3 dispatcher hook + resolver wiring are tested in framework-side
// suites; here we only verify the feature's own surface area.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import {
  setupTestStack,
  type TestStack,
  TestUsers,
  testTenantId,
} from "@cosmicdrift/kumiko-framework/stack";
import * as z from "zod";
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

  test("blocks with 429 once the bucket is drained", async () => {
    // The status query only *reports* state; this proves enforcement —
    // the L3 hook actually rejects traffic over the limit, not just counts.
    for (let i = 0; i < 5; i++) {
      const ok = await stack.http.query("rl-probe:query:ping", {}, admin);
      expect(ok.status).toBe(200);
    }
    const blocked = await stack.http.query("rl-probe:query:ping", {}, admin);
    expect(blocked.status).toBe(429);
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

// The bucket key is caller-supplied, so the tenant boundary has to be drawn
// on it server-side. i18nKey is asserted alongside the code because a plain
// 403 could also come from tenant resolution and would pass either way.
const OUTSIDE_TENANT_KEY = "rateLimiting.errors.bucketOutsideTenant";

describe("rate-limiting feature — bucket tenant scope", () => {
  test("denies an admin the bucket of another tenant", async () => {
    const err = await stack.http.queryErr(
      "rate-limiting:query:status",
      { bucket: `tenant:${testTenantId(2)}`, limit: 5, windowSeconds: 60 },
      admin,
    );
    expect(err.code).toBe("access_denied");
    expect(err.i18nKey).toBe(OUTSIDE_TENANT_KEY);
    expect(err.httpStatus).toBe(403);
  });

  test("denies a key that only starts with the caller's tenant id", async () => {
    const err = await stack.http.queryErr(
      "rate-limiting:query:status",
      { bucket: `tenant:${admin.tenantId}-other`, limit: 5, windowSeconds: 60 },
      admin,
    );
    expect(err.i18nKey).toBe(OUTSIDE_TENANT_KEY);
  });

  test("denies another user's bucket and the global IP buckets", async () => {
    for (const bucket of [`user:${TestUsers.user.id}`, "l1:203.0.113.5", "ip:203.0.113.5"]) {
      const err = await stack.http.queryErr(
        "rate-limiting:query:status",
        { bucket, limit: 5, windowSeconds: 60 },
        admin,
      );
      expect(err.i18nKey).toBe(OUTSIDE_TENANT_KEY);
    }
  });

  test("allows the caller's own tenant and handler-scoped buckets", async () => {
    for (const bucket of [
      `tenant:${admin.tenantId}`,
      `tenant+handler:${admin.tenantId}:rl-probe:query:ping`,
      `user+handler:${admin.id}:rl-probe:query:ping`,
    ]) {
      const status = await stack.http.queryOk<{ bucket: string; remaining: number }>(
        "rate-limiting:query:status",
        { bucket, limit: 5, windowSeconds: 60 },
        admin,
      );
      expect(status.bucket).toBe(bucket);
      expect(status.remaining).toBe(5);
    }
  });

  test("leaves SystemAdmin access to foreign buckets untouched", async () => {
    const status = await stack.http.queryOk<{ bucket: string }>(
      "rate-limiting:query:status",
      { bucket: `tenant:${testTenantId(2)}`, limit: 5, windowSeconds: 60 },
      TestUsers.systemAdmin,
    );
    expect(status.bucket).toBe(`tenant:${testTenantId(2)}`);
  });
});
