import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { defineFeature } from "@cosmicdrift/kumiko-framework/engine";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { TestUsers } from "../../seeding/seed-users.ts";

const bulkFeature = defineFeature("rl-cost", (r) => {
  r.writeHandler({
    name: "bulk",
    schema: z.object({ items: z.array(z.string()).min(1) }),
    handler: async () => ({ isSuccess: true as const, data: {} }),
    access: { roles: ["Admin"] },
    rateLimit: { per: "tenant+handler", limit: 20, windowSeconds: 600 },
    rateLimitCost: (payload) => payload.items.length,
  });
  r.writeHandler({
    name: "broken-cost",
    schema: z.object({ items: z.array(z.string()) }),
    handler: async () => ({ isSuccess: true as const, data: {} }),
    access: { roles: ["Admin"] },
    rateLimit: { per: "tenant+handler", limit: 20, windowSeconds: 600 },
    rateLimitCost: () => Number.NaN,
  });
});

let stack: TestStack;
const admin = TestUsers.admin;
const items = (count: number): { items: string[] } => ({
  items: Array.from({ length: count }, (_, index) => `item-${index}`),
});

beforeAll(async () => {
  stack = await setupTestStack({ features: [bulkFeature] });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
});

describe("rateLimitCost books tokens per payload element", () => {
  test("two 10-item requests exhaust a limit of 20, a third single-item request is rejected", async () => {
    expect((await stack.http.write("rl-cost:write:bulk", items(10), admin)).status).toBe(200);
    expect((await stack.http.write("rl-cost:write:bulk", items(10), admin)).status).toBe(200);
    const blocked = await stack.http.write("rl-cost:write:bulk", items(1), admin);
    expect(blocked.status).toBe(429);
    const body = (await blocked.json()) as { error: { code: string } };
    expect(body.error.code).toBe("rate_limited");
  });

  test("a rejected request consumes nothing", async () => {
    expect((await stack.http.write("rl-cost:write:bulk", items(10), admin)).status).toBe(200);
    expect((await stack.http.write("rl-cost:write:bulk", items(15), admin)).status).toBe(429);
    expect((await stack.http.write("rl-cost:write:bulk", items(10), admin)).status).toBe(200);
  });

  test("a schema-invalid payload costs nothing", async () => {
    for (let attempt = 0; attempt < 25; attempt++) {
      const invalid = await stack.http.write("rl-cost:write:bulk", { items: [] }, admin);
      expect(invalid.status).toBe(400);
    }
    expect((await stack.http.write("rl-cost:write:bulk", items(20), admin)).status).toBe(200);
  });

  test("a cost callback returning NaN fails the write instead of crashing", async () => {
    const res = await stack.http.write("rl-cost:write:broken-cost", items(1), admin);
    expect(res.status).toBe(500);
  });
});
