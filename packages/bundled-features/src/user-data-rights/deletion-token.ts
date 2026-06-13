// Thin wrapper around the shared HMAC-signed-token primitive, pinning the
// purpose to "deletion-request". Mirrors auth-email-password/reset-token.ts —
// email-verified account deletion is an auth-adjacent proof-of-email-ownership
// flow, so it reuses the same self-contained token mechanism (no DB row, no
// Redis: the userId + expiry are baked into the signed token, single-use is
// not required because the grace-period flip is idempotent on a non-active
// user).

import type { Temporal } from "temporal-polyfill";
import { signToken, verifyToken } from "../auth-email-password";

const DELETION_REQUEST_PURPOSE = "deletion-request";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

export function signDeletionToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, DELETION_REQUEST_PURPOSE, ttlMinutes, secret, now);
}

export function verifyDeletionToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, DELETION_REQUEST_PURPOSE, secret, now);
}
