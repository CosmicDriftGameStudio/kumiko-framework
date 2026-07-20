// Thin wrapper around signed-token.ts pinning the purpose to "unlock".
// Mirrors reset-token.ts / verification-token.ts.

import type { Temporal } from "temporal-polyfill";
import { signToken, TokenPurpose, verifyToken } from "./signed-token";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

// @wrapper-known semantic-alias
export function signUnlockToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, TokenPurpose.accountUnlock, ttlMinutes, secret, now);
}

// @wrapper-known semantic-alias
export function verifyUnlockToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, TokenPurpose.accountUnlock, secret, now);
}
