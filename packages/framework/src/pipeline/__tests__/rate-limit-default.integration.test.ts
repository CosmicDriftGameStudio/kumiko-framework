// fw#2861 — systemScope handlers get a default per-tenant rate limit unless
// they declare their own or opt out. Full-stack proof via setupTestStack +
// real HTTP (stack.http.write) — never createTestDispatcher. Modelled on
// rate-limit/__tests__/dispatcher-l3.integration.test.ts.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import * as z from "zod";
import { createSystemUser, defineFeature } from "../../engine";
import type { RateLimitConfig, RateLimitDecision, RateLimitResolver } from "../../rate-limit";
import { createTestUser, setupTestStack, type TestStack, testTenantId } from "../../stack";

function fakeResolver(): {
  readonly resolver: RateLimitResolver;
  readonly calls: Array<{ bucket: string; config: RateLimitConfig }>;
} {
  const calls: Array<{ bucket: string; config: RateLimitConfig }> = [];
  const decision = (config: RateLimitConfig): RateLimitDecision => ({
    allowed: true,
    limit: config.limit,
    remaining: config.limit - 1,
    retryAfterSeconds: 0,
    windowSeconds: config.windowSeconds,
    // @cast-boundary test-fixture — resetAt is never read by the assertions below
    resetAt: undefined as unknown as RateLimitDecision["resetAt"],
  });
  const resolver: RateLimitResolver = {
    check: async (bucket, config) => {
      calls.push({ bucket, config });
      return decision(config);
    },
    enforce: async (bucket, config) => {
      calls.push({ bucket, config });
      return decision(config);
    },
    peek: async (bucket, config) => {
      calls.push({ bucket, config: { ...config } });
      return decision({ ...config, cost: undefined });
    },
  };
  return { resolver, calls };
}

const rlDefaultFeature = defineFeature("rl-default", (r) => {
  r.systemScope();

  r.writeHandler("explicit", z.object({}), async () => ({ isSuccess: true as const, data: {} }), {
    access: { roles: ["Admin"] },
    rateLimit: { per: "tenant", limit: 2, windowSeconds: 60 },
  });

  r.writeHandler(
    "implicit-default",
    z.object({}),
    async () => ({ isSuccess: true as const, data: {} }),
    {
      access: { roles: ["Admin"] },
    },
  );

  r.writeHandler(
    "as-system-probe",
    z.object({}),
    async (event, ctx) => {
      const sysUser = createSystemUser(event.user.tenantId);
      const res = await ctx.writeAs(sysUser, "rl-default:write:implicit-default", {});
      return { isSuccess: true as const, data: res };
    },
    { access: { roles: ["Admin"] } },
  );
});

let stack: TestStack;
let calls: Array<{ bucket: string; config: RateLimitConfig }>;
const TENANT = testTenantId(9201);
const admin = createTestUser({ tenantId: TENANT, roles: ["Admin"] });

beforeAll(async () => {
  const { resolver, calls: recorded } = fakeResolver();
  calls = recorded;
  stack = await setupTestStack({
    features: [rlDefaultFeature],
    extraContext: { rateLimit: resolver },
  });
});

afterAll(async () => {
  await stack.cleanup();
});

describe("systemScope default rate limit (fw#2861)", () => {
  test("explicit rateLimit still wins over the systemScope default", async () => {
    calls.length = 0;
    const res = await stack.http.write("rl-default:write:explicit", {}, admin);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(`tenant:${TENANT}`);
    expect(calls[0]?.config).toEqual({ limit: 2, windowSeconds: 60, cost: undefined });
  });

  test("no declared rateLimit on a systemScope handler -> the default {per:tenant+handler,limit:600,windowSeconds:60} fires", async () => {
    calls.length = 0;
    const res = await stack.http.write("rl-default:write:implicit-default", {}, admin);
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(`tenant+handler:${TENANT}:rl-default:write:implicit-default`);
    expect(calls[0]?.config).toEqual({ limit: 600, windowSeconds: 60, cost: undefined });
  });

  test("a SYSTEM-identity caller (ctx.writeAs) never touches the resolver", async () => {
    calls.length = 0;
    const res = await stack.http.write("rl-default:write:as-system-probe", {}, admin);
    expect(res.status).toBe(200);
    // One call for the probe handler's own dispatch (bucket = admin's tenant+handler),
    // NONE for the inner SYSTEM-identity writeAs to implicit-default.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(`tenant+handler:${TENANT}:rl-default:write:as-system-probe`);
  });
});
