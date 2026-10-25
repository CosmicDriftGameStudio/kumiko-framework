// Token helper unit tests.
//
// Notes:
//   - generateDownloadToken: 32-byte random → base64url plain + SHA256 hash
//   - hashDownloadToken: deterministic for the verification path
//   - Web Crypto is universal: runs in vitest (= Bun runtime via vitest)
//     without a node:crypto import.

import { describe, expect, test } from "bun:test";
import { generateDownloadToken, hashDownloadToken } from "../token-helpers.ts";

describe("generateDownloadToken", () => {
  test("returns plain (base64url) + matching hash (hex)", async () => {
    const { plain, hash } = await generateDownloadToken();

    // base64url-Format: 32 byte random → ceil(32/3*4) = 43 chars,
    // padding stripped. Erlaubt: A-Z a-z 0-9 - _
    expect(plain).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // SHA256 hex = 64 chars
    expect(hash).toMatch(/^[a-f0-9]{64}$/);

    // Hash matched plain
    const verifiedHash = await hashDownloadToken(plain);
    expect(verifiedHash).toBe(hash);
  });

  test("zwei aufeinanderfolgende calls liefern unterschiedliche tokens (kryptographisch random)", async () => {
    const t1 = await generateDownloadToken();
    const t2 = await generateDownloadToken();
    expect(t1.plain).not.toBe(t2.plain);
    expect(t1.hash).not.toBe(t2.hash);
  });

  test("URL-safe token (no +/= in base64url)", async () => {
    // Probabilistic: generate 20 times and verify that none contain unsafe characters.
    // Guards against using btoa alone (which produces + / =).
    for (let i = 0; i < 20; i++) {
      const { plain } = await generateDownloadToken();
      expect(plain).not.toMatch(/[+/=]/);
    }
  });
});

describe("hashDownloadToken", () => {
  test("deterministic — selbe input → selbe hash", async () => {
    const plain = "abc-123_test_token";
    const h1 = await hashDownloadToken(plain);
    const h2 = await hashDownloadToken(plain);
    expect(h1).toBe(h2);
  });

  test("verschiedene inputs → verschiedene hashes", async () => {
    const h1 = await hashDownloadToken("token-A");
    const h2 = await hashDownloadToken("token-B");
    expect(h1).not.toBe(h2);
  });

  test("SHA256-shape: 64 hex chars", async () => {
    const h = await hashDownloadToken("anything");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
