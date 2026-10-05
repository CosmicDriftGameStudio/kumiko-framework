import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { createHmacTokenCodec, type HmacTokenVerifyResult } from "./hmac-token-codec.js";

export type MfaChallengePayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

function isPayload(value: unknown): value is MfaChallengePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["userId"] === "string" && typeof v["tenantId"] === "string";
}

// Domain-separated from mfa-preauth-setup (see hmac-token-codec). Single-use is
// enforced by the consumer via burnToken (purpose "mfa-challenge"); this codec
// only signs and verifies. Brute-forcing the code behind a valid token is
// limited separately in mfa-verify-attempts.ts.
const codec = createHmacTokenCodec("mfa-challenge", isPayload);

export function signMfaChallengeToken(
  payload: MfaChallengePayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  return codec.sign(payload, ttlMinutes, secret, now);
}

export type VerifyMfaChallengeResult = HmacTokenVerifyResult<MfaChallengePayload>;

export function verifyMfaChallengeToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaChallengeResult {
  return codec.verify(token, secret, now);
}
