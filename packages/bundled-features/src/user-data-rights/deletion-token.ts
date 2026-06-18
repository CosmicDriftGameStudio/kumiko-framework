// Thin wrapper around the shared HMAC-signed-token primitive, pinning the
// purpose to "deletion-request". Mirrors auth-email-password/reset-token.ts —
// email-verified account deletion is an auth-adjacent proof-of-email-ownership
// flow, so it reuses the same self-contained token mechanism (no DB row, no
// Redis: the userId + expiry are baked into the signed token).
//
// The token is NOT single-use: replaying it on a still-pending (non-active)
// user is a no-op (confirm hits non-active → cannot_process_deletion). That
// idempotency is only bounded though — after a cancel-deletion the user is
// active again and a still-valid token re-arms a second grace period. The
// replay window is bounded by the TTL; the full fix (per-request requestId
// bound into the token + the user row, nulled on cancel) is deferred as review
// finding #354/1 (needs a shared user-entity migration).

import type { Temporal } from "temporal-polyfill";
import { signToken, verifyToken } from "../auth-email-password";

const DELETION_REQUEST_PURPOSE = "deletion-request";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

// @wrapper-known semantic-alias
export function signDeletionToken(
  userId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, DELETION_REQUEST_PURPOSE, ttlMinutes, secret, now);
}

// @wrapper-known semantic-alias
export function verifyDeletionToken(
  token: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, DELETION_REQUEST_PURPOSE, secret, now);
}
