import { describe, expect, test } from "bun:test";
import { hmacSignatureMatches, signHmacSha256Base64Url } from "../hmac-signature.ts";

describe("hmacSignatureMatches", () => {
  const signature = signHmacSha256Base64Url("payload", "secret");

  test("accepts the exact signature", () => {
    expect(hmacSignatureMatches(signature, signature)).toBe(true);
  });

  test("refuses another spelling that decodes to the same bytes", () => {
    const lastCharacter = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const canonical = lastCharacter.indexOf(signature.slice(-1));
    const sameBytes = `${signature.slice(0, -1)}${lastCharacter[canonical + 1]}`;
    expect(Buffer.from(sameBytes, "base64url").equals(Buffer.from(signature, "base64url"))).toBe(
      true,
    );
    expect(hmacSignatureMatches(signature, sameBytes)).toBe(false);
  });

  test("refuses a signature of another length", () => {
    expect(hmacSignatureMatches(signature, signature.slice(0, -1))).toBe(false);
  });
});
