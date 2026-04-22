// Thin wrapper around signed-token.ts pinning the purpose to "reset".
// Handlers keep their terse API (signResetToken / verifyResetToken) while
// the shared HMAC logic lives in one place. verification-token.ts mirrors
// this pattern with purpose="verify".

import type { Temporal } from "temporal-polyfill";
import { signToken, TokenPurpose, verifyToken } from "./signed-token";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

export function signResetToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, TokenPurpose.passwordReset, ttlMinutes, secret, now);
}

export function verifyResetToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, TokenPurpose.passwordReset, secret, now);
}
