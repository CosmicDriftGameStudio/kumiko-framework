// HMAC-signed token carrying the pending MFA setup state between
// `mfa.enable.start` and `mfa.enable.confirm` — no DB row exists until
// confirm succeeds, so an abandoned setup leaves no trace. The token embeds
// the TOTP secret and recovery-code hashes; this is not a confidentiality
// leak because the client already displayed the same secret as a QR code in
// the same response — the token exists to avoid a second round-trip to
// regenerate it, not to hide it.
//
// Wire format and signing live in hmac-token-codec.ts.
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { createHmacTokenCodec, type HmacTokenVerifyResult } from "./hmac-token-codec.ts";

export type MfaSetupPayload = {
  readonly userId: string;
  readonly totpSecretBase32: string;
  readonly recoveryCodeHashes: readonly string[];
  // Set only by enable-start-preauth.write.ts — the session-authed
  // enable-start.write.ts has no tenantId to carry (event.user.tenantId
  // already covers that path). The pre-auth confirm handler has no session
  // to fall back on, so this is the only source of which tenant to scope to.
  readonly tenantId?: string;
};

function isMfaSetupPayload(value: unknown): value is MfaSetupPayload {
  if (!isPlainObject(value)) return false;
  return (
    typeof value["userId"] === "string" &&
    typeof value["totpSecretBase32"] === "string" &&
    Array.isArray(value["recoveryCodeHashes"]) &&
    value["recoveryCodeHashes"].every((h) => typeof h === "string") &&
    (value["tenantId"] === undefined || typeof value["tenantId"] === "string")
  );
}

const codec = createHmacTokenCodec("mfa-setup", isMfaSetupPayload);

export function signMfaSetupToken(
  payload: MfaSetupPayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  return codec.sign(payload, ttlMinutes, secret, now);
}

export type VerifyMfaSetupResult = HmacTokenVerifyResult<MfaSetupPayload>;

export function verifyMfaSetupToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaSetupResult {
  return codec.verify(token, secret, now);
}
