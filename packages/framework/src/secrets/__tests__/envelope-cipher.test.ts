import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { createEnvMasterKeyProvider } from "../env-master-key-provider";
import { createEnvelopeCipher } from "../envelope-cipher";
import { isStoredEnvelope } from "../stored-envelope";

function makeProvider(currentVersion = 1) {
  return createEnvMasterKeyProvider({
    env: {
      KUMIKO_SECRETS_MASTER_KEY_CURRENT_VERSION: String(currentVersion),
      [`KUMIKO_SECRETS_MASTER_KEY_V${currentVersion}`]: randomBytes(32).toString("base64"),
    },
  });
}

describe("envelope-cipher — encrypt/decrypt", () => {
  test("round-trips plaintext through the JSON envelope format", async () => {
    const cipher = createEnvelopeCipher(makeProvider());
    const stored = await cipher.encrypt("s3cret-smtp-pass");

    expect(stored.startsWith("{")).toBe(true);
    const parsed: unknown = JSON.parse(stored);
    expect(isStoredEnvelope(parsed)).toBe(true);

    expect(await cipher.decrypt(stored)).toBe("s3cret-smtp-pass");
  });

  test("stored value carries the kekVersion for later rotation", async () => {
    const cipher = createEnvelopeCipher(makeProvider(7));
    const stored = await cipher.encrypt("x");
    expect((JSON.parse(stored) as { kekVersion: number }).kekVersion).toBe(7);
  });

  test("tampered ciphertext fails GCM authentication", async () => {
    const cipher = createEnvelopeCipher(makeProvider());
    const stored = JSON.parse(await cipher.encrypt("payload")) as Record<string, unknown>;
    const cipherBytes = Buffer.from(stored["ciphertext"] as string, "base64");
    cipherBytes[0] = (cipherBytes[0] ?? 0) ^ 0xff;
    const tampered = JSON.stringify({ ...stored, ciphertext: cipherBytes.toString("base64") });
    await expect(cipher.decrypt(tampered)).rejects.toThrow();
  });
});

describe("envelope-cipher — malformed input", () => {
  test("rejects invalid JSON that looks like an envelope", async () => {
    const cipher = createEnvelopeCipher(makeProvider());
    await expect(cipher.decrypt("{garbage")).rejects.toThrow(/not valid JSON/);
  });

  test("rejects JSON that is not a StoredEnvelope", async () => {
    const cipher = createEnvelopeCipher(makeProvider());
    await expect(cipher.decrypt('{"foo":"bar"}')).rejects.toThrow(/not a StoredEnvelope/);
  });

  test("empty string is not valid JSON", async () => {
    const cipher = createEnvelopeCipher(makeProvider());
    await expect(cipher.decrypt("")).rejects.toThrow(/not valid JSON/);
  });
});
