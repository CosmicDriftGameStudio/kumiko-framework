import { describe, expect, test } from "bun:test";
import { InMemoryKmsAdapter } from "@cosmicdrift/kumiko-framework/crypto";
import { isPersistentDevDb } from "../is-persistent-dev-db.js";
import { resolveDevPiiKms } from "../resolve-dev-pii-kms.js";

const EPHEMERAL_ENV = {};
const PERSISTENT_ENV = { KUMIKO_DEV_DB_NAME: "my_dev_db" };

describe("isPersistentDevDb", () => {
  test("only a non-empty KUMIKO_DEV_DB_NAME means persistent", () => {
    expect(isPersistentDevDb({})).toBe(false);
    expect(isPersistentDevDb({ KUMIKO_DEV_DB_NAME: "" })).toBe(false);
    expect(isPersistentDevDb({ KUMIKO_DEV_DB_NAME: "my_dev_db" })).toBe(true);
  });
});

describe("resolveDevPiiKms", () => {
  test("ephemeral DB without options encrypts with an in-memory KMS and a throwaway blind-index key", () => {
    const resolved = resolveDevPiiKms({}, EPHEMERAL_ENV);
    expect(resolved.mode).toBe("ephemeral-default");
    expect(resolved.kms).toBeInstanceOf(InMemoryKmsAdapter);
    expect(Buffer.from(resolved.blindIndexKey ?? "", "base64")).toHaveLength(32);
  });

  test("an explicit blindIndexKey wins over the throwaway key", () => {
    const key = Buffer.alloc(32, 3).toString("base64");
    expect(resolveDevPiiKms({ blindIndexKey: key }, EPHEMERAL_ENV).blindIndexKey).toBe(key);
  });

  test("persistent dev DB without options keeps plaintext", () => {
    const resolved = resolveDevPiiKms({}, PERSISTENT_ENV);
    expect(resolved).toEqual({ kms: undefined, blindIndexKey: undefined, mode: "plaintext" });
  });

  test("kms: false keeps plaintext even on an ephemeral DB", () => {
    const resolved = resolveDevPiiKms({ kms: false }, EPHEMERAL_ENV);
    expect(resolved).toEqual({ kms: undefined, blindIndexKey: undefined, mode: "plaintext" });
  });

  test("an app adapter is used as-is, with no throwaway blind-index key", () => {
    const kms = new InMemoryKmsAdapter();
    const resolved = resolveDevPiiKms({ kms }, EPHEMERAL_ENV);
    expect(resolved).toEqual({ kms, blindIndexKey: undefined, mode: "app-kms" });
    expect(resolveDevPiiKms({ kms }, PERSISTENT_ENV).kms).toBe(kms);
  });
});
