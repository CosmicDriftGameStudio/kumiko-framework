import { describe, expect, test } from "bun:test";
import { createEnvMasterKeyProvider } from "@cosmicdrift/kumiko-framework/secrets";
import { resolveBootCrypto } from "../boot-crypto.ts";

const KEK_V1 = Buffer.alloc(32, 1).toString("base64");

describe("resolveBootCrypto", () => {
  test("rejects an app-supplied master key provider whose keyring is unusable, also under a dry run", () => {
    const brokenKeyringEnv = {
      KUMIKO_DRY_RUN_ENV: "boot",
      KUMIKO_SECRETS_MASTER_KEY_V1: KEK_V1,
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
    };
    const provider = createEnvMasterKeyProvider({ env: brokenKeyringEnv });

    expect(() => resolveBootCrypto({}, provider)).toThrow(/currentVersion=2 not present/);
  });

  test("accepts an app-supplied provider with a complete keyring", () => {
    const provider = createEnvMasterKeyProvider({
      env: { KUMIKO_SECRETS_MASTER_KEY_V1: KEK_V1, KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1" },
    });

    expect(resolveBootCrypto({}, provider).masterKeyProvider).toBe(provider);
  });
});
