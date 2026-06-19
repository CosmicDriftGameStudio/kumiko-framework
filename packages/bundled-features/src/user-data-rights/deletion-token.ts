// Thin wrapper around the shared HMAC-signed-token primitive, pinning the
// purpose to "deletion-request". Mirrors auth-email-password/reset-token.ts —
// email-verified account deletion is an auth-adjacent proof-of-email-ownership
// flow, so it reuses the same self-contained token mechanism (no DB row, no
// Redis: the userId + expiry are baked into the signed token).
//
// Replay-after-cancel (#354/1): the per-request `requestId` is folded INTO the
// HMAC purpose (`deletion-request:<requestId>`), not carried in the token body.
// The same id is stored on the user row when the request is minted and nulled
// on cancel. confirm recomputes the HMAC with the row's CURRENT id, so a token
// from a cancelled cycle (row id nulled) or a superseded one (row holds a newer
// id) fails verification — the bounded-TTL replay window is closed without
// touching the shared signToken/verifyToken primitive.

import type { Temporal } from "temporal-polyfill";
import { signToken, verifyToken } from "../auth-email-password";

const DELETION_REQUEST_PURPOSE = "deletion-request";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function deletionPurpose(requestId: string): string {
  return `${DELETION_REQUEST_PURPOSE}:${requestId}`;
}

export function signDeletionToken(
  userId: string,
  requestId: string,
  ttlMinutes: number,
  secret: string,
  now?: Temporal.Instant,
): { token: string; expiresAt: Temporal.Instant } {
  return signToken(userId, deletionPurpose(requestId), ttlMinutes, secret, now);
}

export function verifyDeletionToken(
  token: string,
  requestId: string,
  secret: string,
  now?: Temporal.Instant,
): VerifyResult {
  return verifyToken(token, deletionPurpose(requestId), secret, now);
}

// Reads the userId from the token body WITHOUT verifying the HMAC — used only
// to look up the row's current requestId, which is itself an input to the
// verification below. The signature is still the gate; this peek never grants
// trust. Token format is `<userId>.<expiresAtMs>.<sig>`.
//
// Mirrors verifyToken's structural malformed-checks so an obviously-bogus token
// returns null here (→ generic reject) instead of reaching the DB lookup.
export function peekDeletionTokenUserId(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, expiresAtRaw, sig] = parts;
  if (!userId || !expiresAtRaw || !sig) return null;
  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || String(expiresAtMs) !== expiresAtRaw) return null;
  return userId;
}
