// Thin wrapper around signed-token.ts pinning the purpose to "verify".
// Mirrors reset-token.ts so callers can import a flow-specific helper
// without knowing the underlying HMAC scheme.

import type { Temporal } from "temporal-polyfill";
import { signToken, TokenPurpose, verifyToken } from "./signed-token";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

// @wrapper-known semantic-alias
export function signVerificationToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, TokenPurpose.emailVerification, ttlMinutes, secret, now);
}

// @wrapper-known semantic-alias
export function verifyVerificationToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, TokenPurpose.emailVerification, secret, now);
}
