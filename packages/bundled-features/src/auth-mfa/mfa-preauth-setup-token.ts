import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  createHmacTokenCodec,
  type HmacTokenVerifyResult,
  isUserTenantPayload,
} from "./hmac-token-codec.ts";

export type MfaPreauthSetupPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

// Domain "mfa-preauth-setup" must never equal the challenge domain: a setup
// token has to fail verification as a challenge token and vice versa. The
// challenge token secret is reused deliberately; the domain carries the separation.
const codec = createHmacTokenCodec("mfa-preauth-setup", isUserTenantPayload);

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
