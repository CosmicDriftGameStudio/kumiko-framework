import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { configureBlindIndexKey } from "@cosmicdrift/kumiko-framework/crypto";
import { resetBlindIndexKeyForTests } from "@cosmicdrift/kumiko-testing/helpers";
import { capSubjectHash, capSubjectLimit, capSubjectSchema } from "../cap-subject.ts";

describe("capSubjectHash", () => {
  afterEach(() => {
    resetBlindIndexKeyForTests();
  });

  test("throws without a configured blind index key", () => {
    resetBlindIndexKeyForTests();
    expect(() => capSubjectHash("user:1")).toThrow("KUMIKO_BLIND_INDEX_KEY");
  });

  describe("with a key", () => {
    beforeEach(() => {
      configureBlindIndexKey(randomBytes(32).toString("base64"));
    });

    test("is deterministic, versioned and never contains the plaintext", () => {
      const hash = capSubjectHash("user:alice");
      expect(capSubjectHash("user:alice")).toBe(hash);
      expect(hash.startsWith("kumiko-bidx:v1:")).toBe(true);
      expect(hash).not.toContain("alice");
    });

    test("differs between two subject keys", () => {
      expect(capSubjectHash("user:alice")).not.toBe(capSubjectHash("user:bob"));
    });
  });
});

describe("capSubjectSchema", () => {
  test.each([0, 1.5, -0.1])("rejects share %p", (share) => {
    expect(capSubjectSchema.safeParse({ key: "user:1", share }).success).toBe(false);
  });

  test("accepts a share in (0, 1] and a subject without share", () => {
    expect(capSubjectSchema.safeParse({ key: "user:1", share: 1 }).success).toBe(true);
    expect(capSubjectSchema.safeParse({ key: "user:1" }).success).toBe(true);
  });
});

describe("capSubjectLimit", () => {
  test("floors the share of the limit", () => {
    expect(capSubjectLimit(10, 0.25)).toBe(2);
  });
});
