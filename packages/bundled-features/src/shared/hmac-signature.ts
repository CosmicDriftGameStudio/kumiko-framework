import { createHmac, timingSafeEqual } from "node:crypto";

export function signHmacSha256Base64Url(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function hmacSignatureMatches(
  expectedBase64Url: string,
  providedBase64Url: string,
): boolean {
  // The text is compared, not the decoded bytes: decoding ignores the unused trailing bits of the
  // last character, so one signature would have several accepted spellings.
  const expectedBuf = Buffer.from(expectedBase64Url);
  const providedBuf = Buffer.from(providedBase64Url);
  // timingSafeEqual throws on a length mismatch, and the throw itself is a timing signal.
  return expectedBuf.length === providedBuf.length && timingSafeEqual(expectedBuf, providedBuf);
}
