import { afterEach, describe, expect, test } from "bun:test";
import { createEntity, createTextField } from "../../engine/factories";
import {
  blindIndexFieldName,
  collectLookupableFields,
  computeBlindIndex,
  computeBlindIndexValues,
  configureBlindIndexKey,
  configuredBlindIndexKey,
  decodeBlindIndexKey,
  resetBlindIndexKeyForTests,
} from "../blind-index";
import { InMemoryKmsAdapter } from "../in-memory-kms-adapter";
import {
  configurePiiSubjectKms,
  encryptPiiFieldValues,
  PII_ERASED_SENTINEL,
  resetPiiSubjectKmsForTests,
} from "../pii-field-encryption";

const UUID_A = "6b2f4a0e-1c9d-4f3a-9d2e-00000000000a";
const TEST_KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const TEST_KEY = decodeBlindIndexKey(TEST_KEY_B64);

const userLikeEntity = createEntity({
  fields: {
    email: createTextField({ required: true, pii: true, lookupable: true }),
    role: createTextField(),
  },
  table: "bidx_users",
});

afterEach(() => {
  resetBlindIndexKeyForTests();
  resetPiiSubjectKmsForTests();
});

describe("computeBlindIndex", () => {
  test("deterministic, prefixed, byte-exact (no normalization)", () => {
    const a = computeBlindIndex(TEST_KEY, "marc@example.com");
    expect(a).toStartWith("kumiko-bidx:v1:");
    expect(computeBlindIndex(TEST_KEY, "marc@example.com")).toBe(a);
    expect(computeBlindIndex(TEST_KEY, "Marc@example.com")).not.toBe(a);
  });

  test("different keys produce different indexes", () => {
    const otherKey = decodeBlindIndexKey(Buffer.alloc(32, 9).toString("base64"));
    expect(computeBlindIndex(otherKey, "x")).not.toBe(computeBlindIndex(TEST_KEY, "x"));
  });
});

describe("configureBlindIndexKey", () => {
  test("rejects keys that are not 32 bytes", () => {
    expect(() => configureBlindIndexKey(Buffer.alloc(16, 1).toString("base64"))).toThrow(
      /32 bytes/,
    );
    expect(configuredBlindIndexKey()).toBeUndefined();
  });

  test("undefined clears the key", () => {
    configureBlindIndexKey(TEST_KEY_B64);
    expect(configuredBlindIndexKey()).toBeDefined();
    configureBlindIndexKey(undefined);
    expect(configuredBlindIndexKey()).toBeUndefined();
  });
});

describe("collectLookupableFields", () => {
  test("only text fields with lookupable: true", () => {
    expect(collectLookupableFields(userLikeEntity)).toEqual(["email"]);
  });
});

describe("computeBlindIndexValues", () => {
  test("no key configured → empty (blind-indexing off)", async () => {
    const out = await computeBlindIndexValues({ email: "a@b.c" }, ["email"]);
    expect(out).toEqual({});
  });

  test("plaintext value → HMAC over the value itself", async () => {
    configureBlindIndexKey(TEST_KEY_B64);
    const out = await computeBlindIndexValues({ email: "a@b.c" }, ["email"]);
    expect(out[blindIndexFieldName("email")]).toBe(computeBlindIndex(TEST_KEY, "a@b.c"));
  });

  test("absent field stays untouched, null value → NULL bidx", async () => {
    configureBlindIndexKey(TEST_KEY_B64);
    expect(await computeBlindIndexValues({ role: "admin" }, ["email"])).toEqual({});
    expect(await computeBlindIndexValues({ email: null }, ["email"])).toEqual({
      emailBidx: null,
    });
  });

  test("ciphertext value → decrypt via configured KMS, HMAC over plaintext", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(TEST_KEY_B64);
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, email: "marc@example.com" },
      userLikeEntity,
      ["email"],
      kms,
      { requestId: "test" },
    );
    const out = await computeBlindIndexValues({ email: stored["email"] }, ["email"]);
    expect(out["emailBidx"]).toBe(computeBlindIndex(TEST_KEY, "marc@example.com"));
  });

  test("erased subject → NULL bidx (lookup stops matching)", async () => {
    const kms = new InMemoryKmsAdapter();
    configurePiiSubjectKms(kms);
    configureBlindIndexKey(TEST_KEY_B64);
    const stored = await encryptPiiFieldValues(
      { id: UUID_A, email: "marc@example.com" },
      userLikeEntity,
      ["email"],
      kms,
      { requestId: "test" },
    );
    await kms.eraseKey({ kind: "user", userId: UUID_A });
    const out = await computeBlindIndexValues({ email: stored["email"] }, ["email"]);
    expect(out["emailBidx"]).toBeNull();
  });

  test("erased sentinel → NULL bidx", async () => {
    configureBlindIndexKey(TEST_KEY_B64);
    const out = await computeBlindIndexValues({ email: PII_ERASED_SENTINEL }, ["email"]);
    expect(out["emailBidx"]).toBeNull();
  });
});
