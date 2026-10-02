import { describe, expect, test } from "bun:test";
import { createRateLimitingFeature } from "../feature.js";
import { bucketAccessDenied } from "../handlers/bucket-access.js";

const caller = { id: "u1", tenantId: "t1", roles: ["Admin"] } as const;

describe("rate-limiting error translations", () => {
  test("the denial i18nKey has en and de copy in the feature", () => {
    const key = bucketAccessDenied("tenant:t2", caller)?.i18nKey ?? "";
    expect(key).not.toBe("");
    const entry = createRateLimitingFeature().translations?.[key];
    expect(entry?.["en"]).toBeString();
    expect(entry?.["de"]).toBeString();
  });

  test("the resolver-unavailable key is translated", () => {
    const translations = createRateLimitingFeature().translations ?? {};
    expect(translations["rateLimiting.errors.resolverUnavailable"]?.["en"]).toBeString();
  });

  test("owners may inspect their own buckets, others are denied", () => {
    expect(bucketAccessDenied("tenant:t1", caller)).toBeUndefined();
    expect(bucketAccessDenied("user+handler:u1:h", caller)).toBeUndefined();
    expect(bucketAccessDenied("tenant:t2", caller)).toBeDefined();
    expect(bucketAccessDenied("ip:1.2.3.4", caller)).toBeDefined();
    expect(bucketAccessDenied("ip:1.2.3.4", { ...caller, roles: ["SystemAdmin"] })).toBeUndefined();
  });
});
