import { createHash, timingSafeEqual } from "node:crypto";
import { digestHex } from "../utils/hex.ts";

export function hashOpaqueToken(token: string): Promise<string> {
  return digestHex("SHA-256", token);
}

export function hashOpaqueTokenSync(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function opaqueTokenHashMatches(token: string, storedHash: string): boolean {
  const actual = Buffer.from(hashOpaqueTokenSync(token));
  const expected = Buffer.from(storedHash);
  // timingSafeEqual throws on a length mismatch, and the throw itself is a timing signal.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
