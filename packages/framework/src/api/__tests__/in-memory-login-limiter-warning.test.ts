import { afterEach, describe, expect, test } from "bun:test";
import type { BatchResult, Dispatcher, WriteResult } from "../../pipeline/dispatcher.ts";
import { createAuthRoutes, inMemoryLoginRateLimiterFallback } from "../auth-routes.ts";
import { createJwtHelper } from "../jwt.ts";

const originalNodeEnv = process.env["NODE_ENV"];

function minimalDispatcher(): Dispatcher {
  return {
    async write(): Promise<WriteResult> {
      throw new Error("write not available in this stub");
    },
    async query(): Promise<unknown> {
      return [];
    },
    async *stream(): AsyncGenerator<unknown> {},
    async command(): Promise<void> {},
    async batch(): Promise<BatchResult> {
      return { isSuccess: true, results: [] };
    },
    async resolveAuthClaims(): Promise<Record<string, unknown>> {
      return {};
    },
    async resolveActiveMembership() {
      return { kind: "rejected", reason: "not_a_member" };
    },
    createMemberReader() {
      return async () => {
        throw new Error("createMemberReader not available in this stub");
      };
    },
  };
}

describe("inMemoryLoginRateLimiterFallback", () => {
  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env["NODE_ENV"];
    else process.env["NODE_ENV"] = originalNodeEnv;
  });

  test("outside production it returns a working in-memory limiter", async () => {
    process.env["NODE_ENV"] = "test";

    const limiter = inMemoryLoginRateLimiterFallback();

    expect(await limiter.check("k")).toBe(true);
  });

  test("in production it throws instead of silently limiting per replica", () => {
    process.env["NODE_ENV"] = "production";

    expect(() => inMemoryLoginRateLimiterFallback()).toThrow(/createRedisLoginRateLimiter/);
  });

  test("in production createAuthRoutes aborts when loginRateLimit is not set", () => {
    process.env["NODE_ENV"] = "production";
    const jwt = createJwtHelper("test-secret-at-least-32-bytes-long-for-hs256");
    const baseConfig = {
      loginHandler: "x:write:login",
      membershipQuery: "tenant:query:memberships",
    };

    expect(() => createAuthRoutes(minimalDispatcher(), jwt, baseConfig)).toThrow(
      /createRedisLoginRateLimiter/,
    );
    expect(() =>
      createAuthRoutes(minimalDispatcher(), jwt, { ...baseConfig, loginRateLimit: null }),
    ).not.toThrow();
  });
});
