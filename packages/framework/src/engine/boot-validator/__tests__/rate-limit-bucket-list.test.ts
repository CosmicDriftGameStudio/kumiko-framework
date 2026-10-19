import { describe, expect, test } from "bun:test";
import * as z from "zod";
import { defineFeature } from "../../define-feature.ts";
import type {
  PayloadRateLimitOption,
  RateLimitDeclaration,
  WriteHandlerDefinition,
} from "../../types/index.ts";
import { validateHandlerAccess } from "../entity-handler.ts";

const ip = { per: "ip", limit: 5, windowSeconds: 60 } as const;
const user = { per: "user", limit: 2, windowSeconds: 3600 } as const;
const tenantHandler = { per: "tenant+handler", limit: 3, windowSeconds: 3600 } as const;
const tenant = { per: "tenant", limit: 3, windowSeconds: 3600 } as const;

function featureWith(
  rateLimit: RateLimitDeclaration,
  overrides: Partial<Pick<WriteHandlerDefinition, "access" | "tenantlessAnonymous">> = {},
) {
  return defineFeature("multi-rl", (r) => {
    r.writeHandler({
      name: "act",
      schema: z.object({ topic: z.string() }),
      access: { roles: ["Admin"] },
      rateLimit,
      handler: async () => ({ isSuccess: true as const, data: {} }),
      ...overrides,
    });
  });
}

describe("validateHandlerAccess — rateLimit bucket lists", () => {
  test("a list of distinct buckets boots", () => {
    expect(() => validateHandlerAccess(featureWith([user, tenantHandler]))).not.toThrow();
  });

  test("an empty list is rejected", () => {
    // @cast-boundary test-fixture — the type forbids an empty list, boot validation must too
    const empty = [] as unknown as RateLimitDeclaration;
    expect(() => validateHandlerAccess(featureWith(empty))).toThrow(
      /write handler "multi-rl:write:act" declares rateLimit as an empty array/,
    );
  });

  test("the same per twice is rejected and names the per", () => {
    const feature = featureWith([user, { ...user, limit: 10 }]);
    expect(() => validateHandlerAccess(feature)).toThrow(
      /"multi-rl:write:act" declares rateLimit with per "user" more than once/,
    );
  });

  test("an anonymous handler with [ip, user] is rejected: the user bucket is one global tap", () => {
    const feature = featureWith([ip, user], { access: { roles: ["anonymous"] } });
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimit\.per="user"/);
  });

  test("an anonymous handler with only ip-keyed buckets boots", () => {
    const feature = featureWith([ip, { ...ip, per: "ip+handler" }], {
      access: { roles: ["anonymous"] },
    });
    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });

  test("a tenantless anonymous handler with [ip, tenant] is rejected and names the per", () => {
    const feature = featureWith([ip, tenant], {
      access: { roles: ["anonymous"] },
      tenantlessAnonymous: true,
    });
    expect(() => validateHandlerAccess(feature)).toThrow(/rateLimit\.per "tenant"/);
  });

  test("a tenantless anonymous handler with only ip-scoped buckets boots", () => {
    const feature = featureWith([ip, { ...ip, per: "ip+handler" }], {
      access: { roles: ["anonymous"] },
      tenantlessAnonymous: true,
    });
    expect(() => validateHandlerAccess(feature)).not.toThrow();
  });
});

describe("validateHandlerAccess — additionalRateLimits payload buckets", () => {
  const byTopic: PayloadRateLimitOption = {
    per: { payloadField: "topic" },
    limit: 5,
    windowSeconds: 60,
  };
  const byOther: PayloadRateLimitOption = { ...byTopic, per: { payloadField: "other" } };

  function featureWithPayloadBuckets(additionalRateLimits: readonly PayloadRateLimitOption[]) {
    return defineFeature("payload-rl", (r) => {
      r.writeHandler({
        name: "act",
        schema: z.object({ topic: z.string(), other: z.string() }),
        access: { roles: ["Admin"] },
        additionalRateLimits,
        handler: async () => ({ isSuccess: true as const, data: {} }),
      });
    });
  }

  test("distinct payload fields boot", () => {
    expect(() =>
      validateHandlerAccess(featureWithPayloadBuckets([byTopic, byOther])),
    ).not.toThrow();
  });

  test("the same payloadField twice is rejected and names the field", () => {
    const feature = featureWithPayloadBuckets([byTopic, { ...byTopic, limit: 50 }]);
    expect(() => validateHandlerAccess(feature)).toThrow(
      /"payload-rl:write:act" declares additionalRateLimits with payloadField "topic" more than once/,
    );
  });
});
