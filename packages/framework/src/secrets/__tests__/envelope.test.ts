import { randomBytes } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createEnvMasterKeyProvider } from "../env-master-key-provider";
import { decryptValue, encryptValue } from "../envelope";

function makeEnv(versions: Record<number, Buffer>, currentVersion: number): Record<string, string> {
  const env: Record<string, string> = {
    KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: String(currentVersion),
  };
  for (const [v, key] of Object.entries(versions)) {
    env[`KUMIKO_SECRETS_MASTER_KEY_V${v}`] = key.toString("base64");
  }
  return env;
}

describe("envelope — encryptValue/decryptValue", () => {
  test("round-trips plaintext correctly", async () => {
    const provider = createEnvMasterKeyProvider({
      env: makeEnv({ 1: randomBytes(32) }, 1),
    });
    const envelope = await encryptValue("hello world", provider);
    const back = await decryptValue(envelope, provider);
    expect(back).toBe("hello world");
  });

  test("every encryption produces a distinct IV and ciphertext for the same plaintext", async () => {
    const provider = createEnvMasterKeyProvider({
      env: makeEnv({ 1: randomBytes(32) }, 1),
    });
    const a = await encryptValue("same", provider);
    const b = await encryptValue("same", provider);
    // Different IVs → different ciphertexts, even for the same plaintext.
    // This is a GCM security requirement: reusing (key, IV) breaks the cipher.
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  test("round-trips UTF-8 content including emoji", async () => {
    const provider = createEnvMasterKeyProvider({
      env: makeEnv({ 1: randomBytes(32) }, 1),
    });
    const envelope = await encryptValue("🔐 Geheim — mit Umlauten ä ö ü ß", provider);
    expect(await decryptValue(envelope, provider)).toBe("🔐 Geheim — mit Umlauten ä ö ü ß");
  });

  test("tampered ciphertext fails auth-tag check", async () => {
    const provider = createEnvMasterKeyProvider({
      env: makeEnv({ 1: randomBytes(32) }, 1),
    });
    const envelope = await encryptValue("integrity matters", provider);
    // Flip one byte of the ciphertext. GCM auth tag must reject.
    const tampered = {
      ...envelope,
      ciphertext: Buffer.concat([
        envelope.ciphertext.subarray(0, 1),
        Buffer.from([envelope.ciphertext[0]! ^ 0xff]),
        envelope.ciphertext.subarray(2),
      ]),
    };
    await expect(decryptValue(tampered, provider)).rejects.toThrow();
  });

  test("tampered authTag is rejected", async () => {
    const provider = createEnvMasterKeyProvider({
      env: makeEnv({ 1: randomBytes(32) }, 1),
    });
    const envelope = await encryptValue("auth me", provider);
    const tampered = {
      ...envelope,
      authTag: Buffer.alloc(envelope.authTag.length, 0),
    };
    await expect(decryptValue(tampered, provider)).rejects.toThrow();
  });
});
