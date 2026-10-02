import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";
import { createHmacTokenCodec, type HmacTokenVerifyResult } from "./hmac-token-codec.js";

export type MfaPreauthSetupPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

function isPayload(value: unknown): value is MfaPreauthSetupPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v["userId"] === "string" && typeof v["tenantId"] === "string";
}

// Domain "mfa-preauth-setup" must never equal the challenge domain: a setup
// token has to fail verification as a challenge token and vice versa. The
// challenge token secret is reused deliberately; the domain carries the separation.
const codec = createHmacTokenCodec("mfa-preauth-setup", isPayload);

export function signMfaPreauthSetupToken(
  payload: MfaPreauthSetupPayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  return codec.sign(payload, ttlMinutes, secret, now);
}

export type VerifyMfaPreauthSetupResult = HmacTokenVerifyResult<MfaPreauthSetupPayload>;

export function verifyMfaPreauthSetupToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaPreauthSetupResult {
  return codec.verify(token, secret, now);
}
