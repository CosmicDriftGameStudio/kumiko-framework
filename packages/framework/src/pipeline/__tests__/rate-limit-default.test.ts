import { describe, expect, test } from "bun:test";
import type { Temporal } from "temporal-polyfill";
import { createSystemUser } from "../../engine";
import type { RateLimitConfig, RateLimitDecision, RateLimitResolver } from "../../rate-limit";
import { createTestUser, testTenantId } from "../../stack";
import type { DispatchContext } from "../dispatch-shared";
import { enforceRateLimit } from "../dispatch-shared";

const TENANT = testTenantId(9001);

function fakeResolver(): {
  readonly resolver: RateLimitResolver;
  readonly calls: Array<{ bucket: string; config: RateLimitConfig }>;
} {
  const calls: Array<{ bucket: string; config: RateLimitConfig }> = [];
  const decision: RateLimitDecision = {
    allowed: true,
    limit: 0,
    remaining: 0,
    retryAfterSeconds: 0,
    windowSeconds: 0,
    resetAt: {} as Temporal.Instant,
  };
  const resolver: RateLimitResolver = {
    check: async (bucket, config) => {
      calls.push({ bucket, config });
      return { ...decision, limit: config.limit, windowSeconds: config.windowSeconds };
    },
    enforce: async (bucket, config) => {
      calls.push({ bucket, config });
      return { ...decision, limit: config.limit, windowSeconds: config.windowSeconds };
    },
    peek: async (bucket, config) => {
      calls.push({ bucket, config: { ...config } });
      return { ...decision, limit: config.limit, windowSeconds: config.windowSeconds };
    },
  };
  return { resolver, calls };
}

function fakeCtx(rateLimit: RateLimitResolver | undefined): DispatchContext {
  return {
    appContext: { rateLimit },
  } as unknown as DispatchContext; // @cast-boundary test-fixture — enforceRateLimit only reads ctx.appContext
}

describe("enforceRateLimit — systemScope default", () => {
  test("systemScope handler, no declared rateLimit, resolver configured, regular user -> enforces the default per-tenant+handler limit", async () => {
    const { resolver, calls } = fakeResolver();
    const user = createTestUser({ tenantId: TENANT });

    await enforceRateLimit(fakeCtx(resolver), undefined, "some:write:handler", user, true);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(`tenant+handler:${TENANT}:some:write:handler`);
    expect(calls[0]?.config).toEqual({ limit: 600, windowSeconds: 60, cost: undefined });
  });

  test("systemScope handler, SYSTEM-identity caller -> never touches the resolver", async () => {
    const { resolver, calls } = fakeResolver();
    const systemUser = createSystemUser(TENANT);

    await enforceRateLimit(fakeCtx(resolver), undefined, "some:write:handler", systemUser, true);

    expect(calls).toHaveLength(0);
  });

  test("systemScope handler, no resolver configured -> no-op, no throw", async () => {
    const user = createTestUser({ tenantId: TENANT });

    await expect(
      enforceRateLimit(fakeCtx(undefined), undefined, "some:write:handler", user, true),
    ).resolves.toBeUndefined();
  });

  test("systemScope handler with an explicit rateLimit -> that option is enforced, not the default", async () => {
    const { resolver, calls } = fakeResolver();
    const user = createTestUser({ tenantId: TENANT });

    await enforceRateLimit(
      fakeCtx(resolver),
      { per: "user", limit: 3, windowSeconds: 10 },
      "some:write:handler",
      user,
      true,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.bucket).toBe(`user:${user.id}`);
    expect(calls[0]?.config).toEqual({ limit: 3, windowSeconds: 10, cost: undefined });
  });

  test("systemScope handler with rateLimit: { disabled: true, reason } -> never enforced, no error", async () => {
    const { resolver, calls } = fakeResolver();
    const user = createTestUser({ tenantId: TENANT });

    await expect(
      enforceRateLimit(
        fakeCtx(resolver),
        { disabled: true, reason: "ops replay path" },
        "some:write:handler",
        user,
        true,
      ),
    ).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("non-systemScope handler, no declared rateLimit -> never enforced (unchanged baseline behavior)", async () => {
    const { resolver, calls } = fakeResolver();
    const user = createTestUser({ tenantId: TENANT });

    await enforceRateLimit(fakeCtx(resolver), undefined, "some:write:handler", user, false);

    expect(calls).toHaveLength(0);
  });
});
