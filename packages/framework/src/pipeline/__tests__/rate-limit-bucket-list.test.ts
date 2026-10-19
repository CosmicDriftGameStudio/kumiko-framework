import { describe, expect, test } from "bun:test";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { requestContext } from "../../api/request-context.ts";
import { RateLimitError } from "../../errors/index.ts";
import type { RateLimitBucketRequest, RateLimitResolver } from "../../rate-limit/index.ts";
import { createTestUser, testTenantId } from "../../seeding/seed-users.ts";
import type { DispatchContext } from "../dispatch-shared.ts";
import { enforceRateLimit } from "../dispatch-shared.ts";

const TENANT = testTenantId(9002);
const user = createTestUser({ tenantId: TENANT });
const HANDLER = "f:write:h";

type Call = { readonly method: "enforce" | "enforceAll"; readonly buckets: readonly string[] };

function recordingResolver(): { readonly resolver: RateLimitResolver; readonly calls: Call[] } {
  const calls: Call[] = [];
  const decision = (request: RateLimitBucketRequest) => ({
    allowed: true,
    limit: request.config.limit,
    remaining: request.config.limit,
    retryAfterSeconds: 0,
    windowSeconds: request.config.windowSeconds,
    resetAt: Temporal.Instant.fromEpochMilliseconds(0),
  });
  const resolver: RateLimitResolver = {
    check: async (bucket, config) => decision({ bucket, config }),
    peek: async (bucket, config) => decision({ bucket, config }),
    enforce: async (bucket, config) => {
      calls.push({ method: "enforce", buckets: [bucket] });
      return decision({ bucket, config });
    },
    enforceAll: async (requests) => {
      calls.push({ method: "enforceAll", buckets: requests.map(({ bucket }) => bucket) });
      return requests.map(decision);
    },
  };
  return { resolver, calls };
}

function ctxWith(resolver: RateLimitResolver | undefined): DispatchContext {
  return { appContext: { rateLimit: resolver } } as unknown as DispatchContext; // @cast-boundary test-fixture — enforceRateLimit only reads ctx.appContext
}

function withRequest<T>(fn: () => T, charged: Set<string> = new Set()): T {
  return requestContext.run(
    {
      requestId: "req-1",
      correlationId: "req-1",
      ip: "203.0.113.7",
      chargedRateLimitBuckets: charged,
    },
    fn,
  );
}

const userLimit = { per: "user", limit: 2, windowSeconds: 3600 } as const;
const tenantHandlerLimit = { per: "tenant+handler", limit: 3, windowSeconds: 3600 } as const;
const ipLimit = { per: "ip", limit: 5, windowSeconds: 60 } as const;
const userBucket = `user:${user.id}`;
const tenantHandlerBucket = `tenant+handler:${TENANT}:${HANDLER}`;

describe("enforceRateLimit — bucket lists", () => {
  test("a list charges all buckets through one enforceAll call", async () => {
    const { resolver, calls } = recordingResolver();

    await enforceRateLimit(
      ctxWith(resolver),
      [userLimit, tenantHandlerLimit],
      HANDLER,
      user,
      false,
    );

    expect(calls).toEqual([{ method: "enforceAll", buckets: [userBucket, tenantHandlerBucket] }]);
  });

  test("a single declaration keeps using enforce", async () => {
    const { resolver, calls } = recordingResolver();

    await enforceRateLimit(ctxWith(resolver), userLimit, HANDLER, user, false);

    expect(calls).toEqual([{ method: "enforce", buckets: [userBucket] }]);
  });

  test("a list of one behaves like a single declaration", async () => {
    const { resolver, calls } = recordingResolver();

    await enforceRateLimit(ctxWith(resolver), [userLimit], HANDLER, user, false);

    expect(calls.map(({ method }) => method)).toEqual(["enforce"]);
  });

  test("buckets without a client ip are skipped and the rest is enforced", async () => {
    const { resolver, calls } = recordingResolver();

    await enforceRateLimit(ctxWith(resolver), [ipLimit, userLimit], HANDLER, user, false);

    expect(calls).toEqual([{ method: "enforce", buckets: [userBucket] }]);
  });

  test("a list whose buckets are all skipped does not need a resolver", async () => {
    await expect(
      enforceRateLimit(
        ctxWith(undefined),
        [ipLimit, { ...ipLimit, per: "ip+handler" }],
        HANDLER,
        user,
        false,
      ),
    ).resolves.toBeUndefined();
  });

  test("already charged buckets are filtered out, the remaining ones are enforced", async () => {
    const { resolver, calls } = recordingResolver();
    const charged = new Set<string>();

    await withRequest(
      () => enforceRateLimit(ctxWith(resolver), [userLimit], HANDLER, user, false),
      charged,
    );
    calls.length = 0;
    await withRequest(
      () =>
        enforceRateLimit(
          ctxWith(resolver),
          [userLimit, tenantHandlerLimit, ipLimit],
          HANDLER,
          user,
          false,
        ),
      charged,
    );

    expect(calls).toEqual([
      { method: "enforceAll", buckets: [tenantHandlerBucket, "ip:203.0.113.7"] },
    ]);
  });

  test("buckets are marked charged only after a successful enforceAll", async () => {
    const { resolver } = recordingResolver();
    const rejecting: RateLimitResolver = {
      ...resolver,
      enforceAll: async () => {
        throw new RateLimitError({
          bucket: "user",
          limit: 2,
          windowSeconds: 3600,
          remaining: 0,
          retryAfterSeconds: 10,
          resetAt: "1970-01-01T00:00:00.000Z",
        });
      },
    };
    const charged = new Set<string>();

    await expect(
      withRequest(
        () =>
          enforceRateLimit(
            ctxWith(rejecting),
            [userLimit, tenantHandlerLimit],
            HANDLER,
            user,
            false,
          ),
        charged,
      ),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(charged.size).toBe(0);
  });

  test("a backend failure in enforceAll surfaces as unavailable, not as a limit hit", async () => {
    const { resolver } = recordingResolver();
    const down: RateLimitResolver = {
      ...resolver,
      enforceAll: async () => {
        throw new Error("ECONNREFUSED");
      },
    };

    await expect(
      enforceRateLimit(ctxWith(down), [userLimit, tenantHandlerLimit], HANDLER, user, false),
    ).rejects.toMatchObject({ code: "rate_limit_unavailable" });
  });
});
