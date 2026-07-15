// HMAC-signed token carrying the pending MFA setup state between
// `mfa.enable.start` and `mfa.enable.confirm` — no DB row exists until
// confirm succeeds, so an abandoned setup leaves no trace. The token embeds
// the TOTP secret and recovery-code hashes; this is not a confidentiality
// leak because the client already displayed the same secret as a QR code in
// the same response — the token exists to avoid a second round-trip to
// regenerate it, not to hide it.
//
// Format: <base64url(JSON body)>.<hmac-base64url>. Distinct from
// signed-token.ts (userId-only payload) because setup needs to carry
// generated secret material, not just re-derive it from a lookup.
import { createHmac, timingSafeEqual } from "node:crypto";
import { Temporal } from "temporal-polyfill";

export type MfaSetupPayload = {
  readonly userId: string;
  readonly totpSecretBase32: string;
  readonly recoveryCodeHashes: readonly string[];
};

type EncodedBody = MfaSetupPayload & { readonly expiresAtMs: number };

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signMfaSetupToken(
  payload: MfaSetupPayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): { token: string; expiresAt: Temporal.Instant } {
  const expiresAt = now.add({ minutes: ttlMinutes });
  const body: EncodedBody = { ...payload, expiresAtMs: expiresAt.epochMilliseconds };
  const bodyB64 = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signature = sign(`mfa-setup:${bodyB64}`, secret);
  return { token: `${bodyB64}.${signature}`, expiresAt };
}

export type VerifyMfaSetupResult =
  | { readonly ok: true; readonly payload: MfaSetupPayload; readonly expiresAtMs: number }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function isEncodedBody(value: unknown): value is EncodedBody {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v["userId"] === "string" &&
    typeof v["totpSecretBase32"] === "string" &&
    Array.isArray(v["recoveryCodeHashes"]) &&
    v["recoveryCodeHashes"].every((h) => typeof h === "string") &&
    typeof v["expiresAtMs"] === "number"
  );
}

export function verifyMfaSetupToken(
  token: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyMfaSetupResult {
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [bodyB64, providedSig] = parts;
  if (!bodyB64 || !providedSig) return { ok: false, reason: "malformed" };

  const expected = sign(`mfa-setup:${bodyB64}`, secret);
  const expectedBuf = Buffer.from(expected, "base64url");
  const providedBuf = Buffer.from(providedSig, "base64url");
  // Length check before timingSafeEqual — a length mismatch throws inside
  // timingSafeEqual, and that throw is itself a timing signal.
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
