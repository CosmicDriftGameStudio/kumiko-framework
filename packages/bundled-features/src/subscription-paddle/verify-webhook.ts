// Paddle webhook signature check: `Paddle-Signature: ts=<unix>;h1=<hex>[;h1=<hex>]`,
// HMAC-SHA256 over `${ts}:${rawBody}` keyed with the raw secret string.
//
// Verification always runs against the raw body string; re-serialized JSON
// would change whitespace and break the HMAC. It happens before any parsing,
// so no path bypasses it.

import { createHmac, timingSafeEqual } from "node:crypto";

// Paddle's own SDK accepts 5 s. 300 s matches Stripe here: the foundation
// de-duplicates by event_id and pod clocks drift.
export const PADDLE_WEBHOOK_TOLERANCE_SECONDS = 300;

const SIGNATURE_HEADER = "paddle-signature";
const TIMESTAMP_PATTERN = /^\d+$/;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/i;

type ParsedSignatureHeader = { readonly timestamp: string; readonly signatures: readonly string[] };

function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name === "ts") timestamp = value;
    else if (name === "h1") signatures.push(value);
  }
  return timestamp === undefined ? null : { timestamp, signatures };
}

/** Throws unless one `h1` signature over `rawBody` is valid and the timestamp is
 *  within the tolerance in both directions. Header names must be lower-case. */
export function verifyPaddleSignature(
  rawBody: string,
  headers: Readonly<Record<string, string>>,
  secret: string,
  nowSeconds: number,
): void {
  const header = headers[SIGNATURE_HEADER];
  if (!header) throw new Error("subscription-paddle: paddle-signature header missing");
  const parsed = parseSignatureHeader(header);
  if (!parsed || parsed.signatures.length === 0) {
    throw new Error("subscription-paddle: paddle-signature header is malformed");
  }
  if (!TIMESTAMP_PATTERN.test(parsed.timestamp)) {
    throw new Error("subscription-paddle: webhook ts is not a Unix timestamp in seconds");
  }
  if (Math.abs(nowSeconds - Number(parsed.timestamp)) > PADDLE_WEBHOOK_TOLERANCE_SECONDS) {
    throw new Error("subscription-paddle: webhook timestamp outside the tolerance window");
  }
  const expected = createHmac("sha256", secret).update(`${parsed.timestamp}:${rawBody}`).digest();
  const matches = parsed.signatures.some((signature) => {
    if (!SHA256_HEX_PATTERN.test(signature)) return false;
    const candidate = Buffer.from(signature, "hex");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
  if (!matches) throw new Error("subscription-paddle: webhook signature verify failed");
}
