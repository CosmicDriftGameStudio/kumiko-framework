import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { createHmacTokenCodec, type HmacTokenVerifyResult } from "./hmac-token-codec";

export type MfaChallengePayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

function isPayload(value: unknown): value is MfaChallengePayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["userId"] === "string" && typeof v["tenantId"] === "string";
}

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
