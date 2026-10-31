import { createHmac, timingSafeEqual } from "node:crypto";

export function signHmacSha256Base64Url(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function hmacSignatureMatches(
  expectedBase64Url: string,
  providedBase64Url: string,
): boolean {
  const expectedBuf = Buffer.from(expectedBase64Url, "base64url");
  const providedBuf = Buffer.from(providedBase64Url, "base64url");
  // timingSafeEqual throws on a length mismatch, and the throw itself is a timing signal.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}
