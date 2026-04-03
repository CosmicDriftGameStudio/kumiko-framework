import { describe, expect, test } from "vitest";
import { encrypt, decrypt, deriveKey } from "../encryption";

describe("encryption", () => {
  const key = deriveKey("test-secret-key-at-least-32-chars!!");

  test("encrypt returns a non-empty string", () => {
    const result = encrypt("hello world", key);
    expect(result).toBeTruthy();
    expect(result).not.toBe("hello world");
  });

  test("decrypt returns original plaintext", () => {
    const ciphertext = encrypt("sensitive data", key);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe("sensitive data");
  });

  test("different plaintexts produce different ciphertexts", () => {
    const a = encrypt("aaa", key);
    const b = encrypt("bbb", key);
    expect(a).not.toBe(b);
  });

  test("same plaintext produces different ciphertexts (random IV)", () => {
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a).not.toBe(b);
  });

  test("decrypt with wrong key throws", () => {
    const otherKey = deriveKey("other-secret-key-at-least-32-chars!!");
    const ciphertext = encrypt("secret", key);
    expect(() => decrypt(ciphertext, otherKey)).toThrow();
  });

  test("handles empty string", () => {
    const ciphertext = encrypt("", key);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe("");
  });

  test("handles unicode", () => {
    const ciphertext = encrypt("Ünïcödé 🔐", key);
    const plaintext = decrypt(ciphertext, key);
    expect(plaintext).toBe("Ünïcödé 🔐");
  });

  test("deriveKey produces 32-byte key from any string", () => {
    const k = deriveKey("short");
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });
});
