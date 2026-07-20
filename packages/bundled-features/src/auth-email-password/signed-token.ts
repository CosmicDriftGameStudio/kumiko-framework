// HMAC-signed single-purpose tokens for out-of-band auth flows
// (password-reset, email-verification, future: magic-link).
//
// Format: <userId>.<expiresAtMs>.<hmac-base64url>
//
// The `purpose` is mixed INTO the HMAC input so a token minted for one
// purpose (e.g. password-reset) can't be replayed against an endpoint that
// expects another (e.g. verify-email), even if the caller knows the
// userId and a valid expiry. Purpose is NOT carried in the token body —
// verify() takes the purpose as argument and recomputes.
//
// Timing-safe comparison on verify so a valid-length forgery can't leak
// signal through a short-circuit.

import { createHmac, timingSafeEqual } from "node:crypto";
import { Temporal } from "temporal-polyfill";

export type VerifyResult =
  | { readonly ok: true; readonly userId: string; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

function payload(purpose: string, userId: string, expiresAtMs: number): string {
  return `${purpose}:${userId}.${expiresAtMs}`;
}

export function signToken(
  userId: string,
  purpose: string,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  const expiresAt = now.add({ minutes: ttlMinutes });
  const expiresAtMs = expiresAt.epochMilliseconds;
  const signature = sign(payload(purpose, userId, expiresAtMs), secret);
  return {
    token: `${userId}.${expiresAtMs}.${signature}`,
    expiresAt,
  };
}

export function verifyToken(
  token: string,
  purpose: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyResult {
  const parts = token.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [userId, expiresAtRaw, providedSig] = parts;
  if (!userId || !expiresAtRaw || !providedSig) return { ok: false, reason: "malformed" };

  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || String(expiresAtMs) !== expiresAtRaw) {
    return { ok: false, reason: "malformed" };
  }

  const expected = sign(payload(purpose, userId, expiresAtMs), secret);
  const expectedBuf = Buffer.from(expected, "base64url");
  const providedBuf = Buffer.from(providedSig, "base64url");
  // Length mismatch fails BEFORE timingSafeEqual, which throws on different
  // lengths — but that throw itself leaks via timing. Explicit length check
  // keeps the path uniform.
  if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: "bad_signature" };

  if (Temporal.Instant.compare(now, Temporal.Instant.fromEpochMilliseconds(expiresAtMs)) > 0) {
    return { ok: false, reason: "expired" };
  }

  // expiresAtMs surfaces so callers (burn-store TTL, telemetry, …) don't
  // have to re-parse the token themselves.
  return { ok: true, userId, expiresAtMs };
}

// Canonical purposes baked into the framework. Features that introduce new
// flows extend this set (or just pass an inline string).
export const TokenPurpose = {
  passwordReset: "reset",
  emailVerification: "verify",
  accountUnlock: "unlock",
} as const;
