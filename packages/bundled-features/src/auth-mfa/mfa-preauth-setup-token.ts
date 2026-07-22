// HMAC-signed token minted by login.write.ts when enforcement policy blocks
// an unenrolled user (mfa-setup-required) — proves the password check
// already succeeded, so a later pre-auth enable-start variant (#1231) can
// let the user enroll without a full session. No secret material (unlike
// mfa-setup-token.ts) — just enough to look the user back up.
//
// Same domain-separated HMAC shape as mfa-challenge-token.ts, distinct
// signing string so this can never be replayed as a login challenge or
// vice versa. Reuses challengeTokenSecret rather than adding a third
// feature secret: both tokens assert the identical trust boundary
// ("password already verified, short-lived follow-up allowed").
import { createHmac, timingSafeEqual } from "node:crypto";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { Temporal } from "temporal-polyfill";

export type MfaPreauthSetupPayload = {
  readonly userId: string;
  readonly tenantId: TenantId;
};

type EncodedBody = MfaPreauthSetupPayload & { readonly expiresAtMs: number };

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signMfaPreauthSetupToken(
  payload: MfaPreauthSetupPayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  const expiresAt = now.add({ minutes: ttlMinutes });
  const body: EncodedBody = { ...payload, expiresAtMs: expiresAt.epochMilliseconds };
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = sign(`mfa-preauth-setup:${bodyB64}`, secret);
  return { token: `${bodyB64}.${signature}`, expiresAt };
}

export type VerifyMfaPreauthSetupResult =
  | { readonly ok: true; readonly payload: MfaPreauthSetupPayload; readonly expiresAtMs: number }
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

export function verifyMfaPreauthSetupToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaPreauthSetupResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [bodyB64, providedSig] = parts;
  if (!bodyB64 || !providedSig) return { ok: false, reason: "malformed" };

  const expected = sign(`mfa-preauth-setup:${bodyB64}`, secret);
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
