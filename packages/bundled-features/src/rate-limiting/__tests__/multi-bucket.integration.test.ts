// Several rate-limit buckets on one handler over real HTTP and the Redis resolver: each bucket
// applies on its own, and a request rejected by one bucket charges none of them.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature, type SessionUser } from "@cosmicdrift/kumiko-framework/engine";
import { createTestUser, TestUsers } from "@cosmicdrift/kumiko-framework/seeding";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { createRateLimitingFeature } from "../feature.ts";

const LONG_WINDOW_SECONDS = 3600;
const HANDLER = "rl-multi:write:submit";

const multiBucketFeature = defineFeature("rl-multi", (r) => {
  r.writeHandler({
    name: "submit",
    schema: z.object({}),
    handler: async () => ({ isSuccess: true as const, data: {} }),
    access: { roles: ["Admin"] },
    rateLimit: [
      { per: "user", limit: 2, windowSeconds: LONG_WINDOW_SECONDS },
      { per: "tenant+handler", limit: 3, windowSeconds: LONG_WINDOW_SECONDS },
    ],
  });
});

let stack: TestStack;
const userA: SessionUser = TestUsers.admin;
const userB = createTestUser({ id: 2001 });

beforeAll(async () => {
  stack = await setupTestStack({ features: [createRateLimitingFeature(), multiBucketFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

async function remaining(caller: SessionUser, bucket: string, limit: number): Promise<number> {
  const status = await stack.http.queryOk<{ remaining: number }>(
    "rate-limiting:query:status",
    { bucket, limit, windowSeconds: LONG_WINDOW_SECONDS },
    caller,
  );
  return status.remaining;
}

async function rejectedBucket(caller: SessionUser): Promise<string | undefined> {
  const res = await stack.http.write(HANDLER, {}, caller);
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: { code: string; details?: { bucket?: string } } };
  expect(body.error.code).toBe("rate_limited");
  return body.error.details?.bucket;
}

describe("handler with a rateLimit bucket list", () => {
  test("the user bucket rejects the third call of one user", async () => {
    await stack.http.writeOk(HANDLER, {}, userA);
    await stack.http.writeOk(HANDLER, {}, userA);

    expect(await rejectedBucket(userA)).toBe("user");
  });

  test("a rejected request charges no bucket, so the tenant bucket still has its remaining token", async () => {
    await stack.http.writeOk(HANDLER, {}, userA);
    await stack.http.writeOk(HANDLER, {}, userA);
    await rejectedBucket(userA);

    const tenantBucket = `tenant+handler:${userA.tenantId}:${HANDLER}`;
    expect(await remaining(userA, tenantBucket, 3)).toBe(1);

    await stack.http.writeOk(HANDLER, {}, userB);

    expect(await rejectedBucket(userB)).toBe("tenant+handler");
    expect(await remaining(userB, `user:${userB.id}`, 2)).toBe(1);
    expect(await remaining(userB, tenantBucket, 3)).toBe(0);
  });
});
