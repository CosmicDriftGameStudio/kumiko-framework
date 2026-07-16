// HMAC-signed token minted by the login handler once the password check
// succeeds but a second factor is still owed. Carries just enough to look
// the user back up at `/auth/mfa/verify` — no secret material (unlike
// mfa-setup-token.ts, this token is never shown to the user, only round-
// tripped by the client between the two login requests).
//
// Format: <base64url(JSON body)>.<hmac-base64url> — same shape as
// mfa-setup-token.ts, distinct HMAC domain-separation string so a setup
// token can never be replayed as a challenge token or vice versa.
//
// Replay protection: burnToken()/unburnToken() from shared/token-burn-store
// (purpose "mfa-challenge") make the token single-use on a SUCCESSFUL
// verify. Brute-force protection is a SEPARATE mechanism — see
// mfa-verify-attempts.ts — because burn-on-success alone doesn't cap wrong
// guesses against a still-valid token.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";

export type MfaChallengePayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

type EncodedBody = MfaChallengePayload & { readonly expiresAtMs: number };

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signMfaChallengeToken(
  payload: MfaChallengePayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  const expiresAt = now.add({ minutes: ttlMinutes });
  const body: EncodedBody = { ...payload, expiresAtMs: expiresAt.epochMilliseconds };
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = sign(`mfa-challenge:${bodyB64}`, secret);
  return { token: `${bodyB64}.${signature}`, expiresAt };
}

export type VerifyMfaChallengeResult =
  | { readonly ok: true; readonly payload: MfaChallengePayload; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function isEncodedBody(value: unknown): value is EncodedBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["userId"] === "string" &&
    typeof v["tenantId"] === "string" &&
    typeof v["expiresAtMs"] === "number"
  );
}

export function verifyMfaChallengeToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaChallengeResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [bodyB64, providedSig] = parts;
  if (!bodyB64 || !providedSig) return { ok: false, reason: "malformed" };

  const expected = sign(`mfa-challenge:${bodyB64}`, secret);
  const expectedBuf = Buffer.from(expected, "base64url");
  const providedBuf = Buffer.from(providedSig, "base64url");
  if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: "bad_signature" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(bodyB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isEncodedBody(parsed)) return { ok: false, reason: "malformed" };

  if (
    Temporal.Instant.compare(now, Temporal.Instant.fromEpochMilliseconds(parsed.expiresAtMs)) > 0
  ) {
    return { ok: false, reason: "expired" };
  }

  const { expiresAtMs, ...payload } = parsed;
  return { ok: true, payload, expiresAtMs };
}
