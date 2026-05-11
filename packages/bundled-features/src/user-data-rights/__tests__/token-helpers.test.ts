// Token-Helper Unit-Tests (S2.U3 Atom 4a).
//
// Pinst:
//   - generateDownloadToken: 32-byte random → base64url plain + SHA256 hash
//   - hashDownloadToken: deterministisch (verify-Pfad fuer Atom 4b)
//   - Web-Crypto-Universal: laeuft in vitest (= bun-runtime via vitest)
//     ohne node:crypto-Import. Memory `feedback_universal_deps`.

import { describe, expect, test } from "vitest";
import { generateDownloadToken, hashDownloadToken } from "../token-helpers";

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

  test("Token URL-safe (kein +/= im base64url)", async () => {
    // Probabilistisch: 20× generieren + verifizieren dass keiner unsafe-chars hat.
    // Pin gegen reine btoa-Verwendung (die liefert + / =).
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
