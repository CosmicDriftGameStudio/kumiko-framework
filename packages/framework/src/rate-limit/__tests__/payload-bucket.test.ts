import { describe, expect, test } from "bun:test";
import {
  buildPayloadBucketKey,
  createPayloadDigest,
  normalizePayloadBucketValue,
} from "../bucket.js";

describe("payload bucket key", () => {
  test("normalization trims and lowercases so spelling variants share a bucket", () => {
    expect(normalizePayloadBucketValue("  Foo@Example.com ")).toBe("foo@example.com");
  });

  test("digest is keyed: same value and secret agree, another secret differs", () => {
    const first = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const second = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const rotated = createPayloadDigest("secret-b-with-enough-length-0123456789");
    expect(first("foo@example.com")).toBe(second("foo@example.com"));
    expect(first("foo@example.com")).not.toBe(rotated("foo@example.com"));
    expect(first("foo@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });

  test("key carries handler and field but never the plaintext value", () => {
    const digest = createPayloadDigest("secret-a-with-enough-length-0123456789");
    const key = buildPayloadBucketKey("a:write:x", "email", digest("foo@example.com"));
    expect(key.startsWith("payload+handler:a:write:x:email:")).toBe(true);
    expect(key).not.toContain("foo");
  });
});
