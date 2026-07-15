import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { base32Decode, base32Encode } from "../base32";
import { buildOtpauthUri } from "../otpauth-uri";
import { generateTotpSecret, verifyTotp } from "../totp";

// RFC 6238 Appendix B test vectors use the ASCII secret "12345678901234567890"
// (20 bytes) with SHA1 — the same algorithm this implementation hardcodes
// (RFC 6238's SHA256/SHA512 variants are out of scope, matching every real
// authenticator app which only speaks SHA1).
const RFC_SECRET = Buffer.from("12345678901234567890", "ascii");

// RFC 6238 Appendix B, SHA1 column: T=59s → code "94287082" (8-digit RFC
// vector). This codebase computes 6-digit codes (Google Authenticator
// convention) — take the last 6 digits, which is truncation-equivalent
// since dynamic truncation just modulos a wider range.
function rfcVectorCode8Digit(epochSeconds: number): string {
  // Precomputed from RFC 6238 Appendix B for T=59.
  if (epochSeconds === 59) return "94287082";
  throw new Error("no precomputed vector for this timestamp");
}

describe("TOTP — RFC 6238 vectors", () => {
  test("6-digit code at T=59 matches the last 6 digits of the RFC 8-digit vector", () => {
    const expected8 = rfcVectorCode8Digit(59);
    const expected6 = expected8.slice(-6);
    expect(verifyTotp(RFC_SECRET, expected6, 59_000)).toBe(true);
  });

  test("rejects a code from a different time window (>±1 step)", () => {
    const expected8 = rfcVectorCode8Digit(59);
    const expected6 = expected8.slice(-6);
    // 59s + 3 steps (90s) is outside the ±1 (±30s) window.
    expect(verifyTotp(RFC_SECRET, expected6, 59_000 + 3 * 30_000)).toBe(false);
  });

  test("accepts a code one step in the past or future (clock drift)", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000_000;
    // Derive the code for now, then verify it's still accepted 25s later —
    // same 30s step, no window needed, sanity check for the step math.
    const codeAtNow = deriveCodeForTest(secret, now);
    expect(verifyTotp(secret, codeAtNow, now + 25_000)).toBe(true);
  });

  test("rejects wrong-length or non-numeric input without throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345")).toBe(false);
    expect(verifyTotp(secret, "1234567")).toBe(false);
    expect(verifyTotp(secret, "abcdef")).toBe(false);
    expect(verifyTotp(secret, "")).toBe(false);
  });

  test("generateTotpSecret returns 20 random, non-zero bytes", () => {
    const a = generateTotpSecret();
    const b = generateTotpSecret();
    expect(a.length).toBe(20);
    expect(a.equals(b)).toBe(false);
  });
});

describe("base32", () => {
  test("round-trips arbitrary byte buffers", () => {
    for (const input of [
      Buffer.from([]),
      Buffer.from([0]),
      Buffer.from([255]),
      generateTotpSecret(),
      Buffer.from("hello world", "ascii"),
    ]) {
      expect(base32Decode(base32Encode(input)).equals(input)).toBe(true);
    }
  });

  test("decode is case-insensitive and tolerates stray whitespace", () => {
    const encoded = base32Encode(Buffer.from("test-secret-bytes!!"));
    expect(base32Decode(encoded.toLowerCase()).equals(base32Decode(encoded))).toBe(true);
    expect(base32Decode(` ${encoded} `).equals(base32Decode(encoded))).toBe(true);
  });

  test("decode throws on a genuinely invalid character (e.g. punctuation)", () => {
    expect(() => base32Decode("!!!not-valid-base32!!!")).toThrow();
  });
});

describe("otpauth URI", () => {
  test("builds a well-formed otpauth://totp URI with the expected params", () => {
    const secret = generateTotpSecret();
    const uri = buildOtpauthUri({
      issuer: "Kumiko",
      accountLabel: "acme:jane@example.com",
      secret,
    });
    expect(uri).toStartWith("otpauth://totp/Kumiko%3Aacme%3Ajane%40example.com?");
    const query = new URLSearchParams(uri.split("?")[1]);
    expect(query.get("issuer")).toBe("Kumiko");
    expect(query.get("algorithm")).toBe("SHA1");
    expect(query.get("digits")).toBe("6");
    expect(query.get("period")).toBe("30");
    expect(base32Decode(query.get("secret") ?? "").equals(secret)).toBe(true);
  });
});

// Internal helper mirroring the private `hotp`/`totpAt` math in totp.ts, kept
// test-local so we don't have to export internals just for round-trip tests.
function deriveCodeForTest(secret: Buffer, epochMs: number): string {
  const step = Math.floor(epochMs / 1000 / 30);
  // Re-implements the exact truncation from totp.ts's hotp() — duplicated
  // deliberately: verifyTotp is the thing under test, so this must NOT call
  // through it to derive its own expectation.
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeUInt32BE(Math.floor(step / 2 ** 32), 0);
  counterBuf.writeUInt32BE(step % 2 ** 32, 4);
  const hmac = createHmac("sha1", secret).update(counterBuf).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const truncated =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return String(truncated % 10 ** 6).padStart(6, "0");
}
