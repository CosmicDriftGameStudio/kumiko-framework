import { describe, expect, test } from "bun:test";
import { createEncryptionProvider } from "../encryption";

// 32 bytes base64-encoded for AES-256
const TEST_KEY = Buffer.from("a]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");

describe("EncryptionProvider", () => {
  test("encrypt + decrypt roundtrip returns original", () => {
    const provider = createEncryptionProvider(TEST_KEY);
    const ciphertext = provider.encrypt("hello world");
    expect(provider.decrypt(ciphertext)).toBe("hello world");
  });

  test("same plaintext produces different ciphertexts (random IV)", () => {
    const provider = createEncryptionProvider(TEST_KEY);
    const a = provider.encrypt("same");
    const b = provider.encrypt("same");
    expect(a).not.toBe(b);
  });

  test("decrypt with different key throws", () => {
    const key2 = Buffer.from("x]bJm#kP9xQ2@wN!vL$hR5yT8eU0iO3f").toString("base64");
    const p1 = createEncryptionProvider(TEST_KEY);
    const p2 = createEncryptionProvider(key2);
    const ciphertext = p1.encrypt("secret");
    expect(() => p2.decrypt(ciphertext)).toThrow();
  });

  test("handles unicode and emoji", () => {
    const provider = createEncryptionProvider(TEST_KEY);
    const ciphertext = provider.encrypt("Ünïcödé 🔐");
    expect(provider.decrypt(ciphertext)).toBe("Ünïcödé 🔐");
  });

  test("throws on invalid key length", () => {
    const shortKey = Buffer.from("too-short").toString("base64");
    expect(() => createEncryptionProvider(shortKey)).toThrow(/32 bytes/);
  });
});
