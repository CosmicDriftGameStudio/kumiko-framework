import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createEnvMasterKeyProvider } from "../env-master-key-provider";

function env(vars: Record<string, string>): Record<string, string> {
  return vars;
}

describe("EnvMasterKeyProvider — keyring loading", () => {
  test("accepts a single-version keyring", () => {
    const key = randomBytes(32).toString("base64");
    const provider = createEnvMasterKeyProvider({
      env: env({
        KUMIKO_SECRETS_MASTER_KEY_V1: key,
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      }),
    });
    expect(provider.currentVersion()).toBe(1);
  });

  test("accepts multi-version keyring and respects CURRENT_VERSION override", () => {
    const provider = createEnvMasterKeyProvider({
      env: env({
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_V2: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_V3: randomBytes(32).toString("base64"),
        // Explicit: even though V3 exists, V2 stays active until ops flips this.
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "2",
      }),
    });
    expect(provider.currentVersion()).toBe(2);
  });

  test("rejects boot when no KEK is set", () => {
    expect(() =>
      createEnvMasterKeyProvider({
        env: env({ KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1" }),
      }),
    ).toThrow(/no KEK found/);
  });

  test("rejects boot when CURRENT_VERSION is missing", () => {
    expect(() =>
      createEnvMasterKeyProvider({
        env: env({ KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64") }),
      }),
    ).toThrow(/CURRENT_VERSION not set/);
  });

  test("rejects boot when CURRENT_VERSION points to an absent KEK", () => {
    expect(() =>
      createEnvMasterKeyProvider({
        env: env({
          KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "7",
        }),
      }),
    ).toThrow(/currentVersion=7 not present/);
  });

  test("rejects KEK with wrong byte length (not AES-256)", () => {
    expect(() =>
      createEnvMasterKeyProvider({
        env: env({
          // 16 bytes = AES-128 key, not what we want
          KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(16).toString("base64"),
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
        }),
      }),
    ).toThrow(/exactly 32 bytes/);
  });

  test("rejects non-numeric CURRENT_VERSION", () => {
    expect(() =>
      createEnvMasterKeyProvider({
        env: env({
          KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
          KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "latest",
        }),
      }),
    ).toThrow(/must be a positive integer/);
  });
});

describe("EnvMasterKeyProvider — wrap/unwrap", () => {
  test("wrap then unwrap round-trips the DEK bytes", async () => {
    const provider = createEnvMasterKeyProvider({
      env: env({
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      }),
    });
    const dek = randomBytes(32);
    const wrapped = await provider.wrapDek(dek);
    expect(wrapped.kekVersion).toBe(1);
    const unwrapped = await provider.unwrapDek(wrapped.encryptedDek, wrapped.kekVersion);
    expect(unwrapped.equals(dek)).toBe(true);
  });

  test("unwrap throws for an unknown kekVersion with a clear error", async () => {
    const provider = createEnvMasterKeyProvider({
      env: env({
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      }),
    });
    await expect(provider.unwrapDek(Buffer.alloc(60), 99)).rejects.toThrow(/no KEK for version 99/);
  });

  test("isAvailable returns true after successful boot", async () => {
    const provider = createEnvMasterKeyProvider({
      env: env({
        KUMIKO_SECRETS_MASTER_KEY_V1: randomBytes(32).toString("base64"),
        KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: "1",
      }),
    });
    expect(await provider.isAvailable()).toBe(true);
  });
});
