import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_HEADER_PATTERN = /^sha256=([0-9a-f]{64})$/i;

/** Meta's `X-Hub-Signature-256` value for a raw body: `sha256=<hex HMAC with the app secret>`. */
export function signMetaBody(appSecret: string, rawBody: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
}

export function isValidMetaSignature(
  appSecret: string,
  rawBody: string,
  header: string | undefined,
): boolean {
  const match = header === undefined ? null : SIGNATURE_HEADER_PATTERN.exec(header.trim());
  if (match === null) return false;
  const received = Buffer.from((match[1] ?? "").toLowerCase(), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/** Hashing first gives both sides one length, so the comparison leaks nothing about the secret's length. */
export function secretsMatch(candidate: string, secret: string): boolean {
  const digestOf = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digestOf(candidate), digestOf(secret));
}
