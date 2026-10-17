import { describe, expect, test } from "bun:test";
import { createAnonymousUser, SYSTEM_TENANT_ID } from "../../engine/index.js";
import type { RateLimitPer } from "../../engine/types/index.js";
import { createHandlerBoundDigest } from "../../pipeline/dispatch-shared.js";
import {
  buildBucketKey,
  buildPayloadBucketKey,
  createPayloadDigest,
  normalizePayloadBucketValue,
  toPublicBucketName,
} from "../bucket.js";

describe("payload bucket key", () => {
  test("normalization trims and lowercases so spelling variants share a bucket", () => {
    expect(normalizePayloadBucketValue("  Foo@Example.com ")).toBe("foo@example.com");
  });

  test("NFKC folds fullwidth characters so lookalike spellings share a bucket", () => {
    expect(normalizePayloadBucketValue("Ｆｏｏ＠Ｅｘａｍｐｌｅ．ｃｏｍ", "email")).toBe(
      "foo@example.com",
    );
  });

  test("digest is keyed: same value and secret agree, another secret differs", () => {
    const first = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const second = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const rotated = createPayloadDigest("secret-b-with-enough-length-0123456789");
    expect(first("foo@example.com")).toBe(second("foo@example.com"));
    expect(first("foo@example.com")).not.toBe(rotated("foo@example.com"));
    expect(first("foo@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("handler-bound digest differs per handler and from the raw payload digest", () => {
    const digest = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const forFirst = createHandlerBoundDigest(digest, "a:write:first");
    const forSecond = createHandlerBoundDigest(digest, "a:write:second");
    expect(forFirst("foo@example.com")).toBe(forFirst("foo@example.com"));
    expect(forFirst("foo@example.com")).not.toBe(forSecond("foo@example.com"));
    expect(forFirst("foo@example.com")).not.toBe(digest("foo@example.com"));
  });

  test("key carries handler and field but never the plaintext value", () => {
    const digest = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const key = buildPayloadBucketKey("tenant-1", "a:write:x", "email", digest("foo@example.com"));
    expect(key.startsWith("payload+handler:tenant-1:a:write:x:email:")).toBe(true);
    expect(key).not.toContain("foo");
  });

  test("the same address in two tenants lands in separate buckets", () => {
    const digest = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const hash = digest("foo@example.com");
    expect(buildPayloadBucketKey("tenant-a", "a:write:x", "email", hash)).not.toBe(
      buildPayloadBucketKey("tenant-b", "a:write:x", "email", hash),
    );
  });

  test("email normalization strips the +tag so plus-addressed variants share a bucket", () => {
    const digest = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const keyOf = (address: string) =>
      buildPayloadBucketKey(
        "tenant-1",
        "a:write:x",
        "email",
        digest(normalizePayloadBucketValue(address, "email")),
      );
    expect(keyOf("a+1@x.com")).toBe(keyOf("A+2@x.com"));
    expect(keyOf("a+1@x.com")).toBe(keyOf("a@x.com"));
    expect(keyOf("a+1@x.com")).not.toBe(keyOf("b@x.com"));
  });

  test("email normalization keeps dots and leaves non-email values and the default mode alone", () => {
    expect(normalizePayloadBucketValue("v.ictim+x@Example.com", "email")).toBe(
      "v.ictim@example.com",
    );
    expect(normalizePayloadBucketValue("no-at-sign+tag", "email")).toBe("no-at-sign+tag");
    expect(normalizePayloadBucketValue("+tag@x.com", "email")).toBe("+tag@x.com");
    expect(normalizePayloadBucketValue("a+1@x.com")).toBe("a+1@x.com");
  });
});

describe("toPublicBucketName", () => {
  const PER_VALUES: RateLimitPer[] = [
    "user",
    "tenant",
    "ip",
    "user+handler",
    "tenant+handler",
    "ip+handler",
  ];

  test.each(PER_VALUES)("a %s bucket key exposes only its scope tag", (per) => {
    const user = createAnonymousUser(SYSTEM_TENANT_ID);
    const result = buildBucketKey(
      { per, limit: 1, windowSeconds: 60 },
      { handlerName: "a:write:x", user, ip: "2001:db8::1" },
    );
    expect(result.kind).toBe("key");
    if (result.kind === "key") expect(toPublicBucketName(result.key)).toBe(per);
  });

  test("a payload bucket key exposes only its scope tag", () => {
    const key = buildPayloadBucketKey("tenant-1", "a:write:x", "email", "abc");
    expect(toPublicBucketName(key)).toBe("payload+handler");
  });
});
