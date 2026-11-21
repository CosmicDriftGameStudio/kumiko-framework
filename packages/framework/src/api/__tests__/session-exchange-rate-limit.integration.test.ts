// POST /auth/session-exchange counts before dispatch and refunds only its own slot after a
// success: NAT'd legitimate logins must not lock each other out, failures stay capped.

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { setupTestStack, type TestStack } from "@cosmicdrift/kumiko-testing/stack";
import * as z from "zod";
import { defineFeature } from "../../engine/index.ts";
import { UnprocessableError, writeFailure } from "../../errors/index.ts";
import { TestUsers } from "../../seeding/seed-users.ts";
import { createInMemoryLoginRateLimiter } from "../auth-routes.ts";

const LIMIT = 10;
let handlerCalls = 0;
let stack: TestStack;
let nextIp = 0;

const probeFeature = defineFeature("exchangeprobe", (r) => {
  r.writeHandler({
    name: "exchange",
    schema: z.object({ ok: z.boolean() }),
    handler: async (event) => {
      handlerCalls++;
      if (!event.payload.ok) return writeFailure(new UnprocessableError("invalid_credentials"));
      return { isSuccess: true as const, data: { kind: "auth-session", session: TestUsers.user } };
    },
    access: { roles: ["anonymous"] },
    rateLimit: { per: "ip", limit: 10_000, windowSeconds: 60 },
  });
});

beforeAll(async () => {
  stack = await setupTestStack({
    features: [probeFeature],
    trustedProxyHops: 1,
    authConfig: {
      membershipQuery: "tenant:query:memberships",
      sessionExchangeHandlers: { probe: "exchangeprobe:write:exchange" },
      sessionExchangeRateLimit: createInMemoryLoginRateLimiter(LIMIT, 60_000),
    },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

beforeEach(async () => {
  await stack.redis.flushNamespace();
  handlerCalls = 0;
});

function freshIp(): string {
  nextIp += 1;
  return `10.30.${Math.floor(nextIp / 250)}.${(nextIp % 250) + 1}`;
}

async function exchange(ip: string, ok: boolean): Promise<number> {
  const res = await stack.app.request("/api/auth/session-exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ method: "probe", payload: { ok } }),
  });
  return res.status;
}

describe("session-exchange rate limit", () => {
  test("successful exchanges from one IP never exhaust the limit", async () => {
    const ip = freshIp();
    for (let i = 0; i < 15; i++) expect(await exchange(ip, true)).toBe(200);
  });

  test("failures stay capped: the request after the limit is rejected, even a valid one", async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT; i++) expect(await exchange(ip, false)).not.toBe(429);
    expect(await exchange(ip, true)).toBe(429);
    expect(handlerCalls).toBe(LIMIT);
  });

  test("a parallel burst of failures lets at most the limit reach the handler", async () => {
    const ip = freshIp();
    const statuses = await Promise.all(Array.from({ length: 20 }, () => exchange(ip, false)));
    expect(handlerCalls).toBeLessThanOrEqual(LIMIT);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(20 - LIMIT);
  });

  test("successes give back only their own slot", async () => {
    const ip = freshIp();
    for (let i = 0; i < LIMIT - 1; i++) expect(await exchange(ip, false)).not.toBe(429);
    for (let i = 0; i < 5; i++) expect(await exchange(ip, true)).toBe(200);
    expect(await exchange(ip, false)).not.toBe(429);
    expect(await exchange(ip, false)).toBe(429);
  });
});
