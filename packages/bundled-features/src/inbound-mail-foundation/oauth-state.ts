// HMAC-signed OAuth-`state` parameter for the connect flow.
//
// Binds {tenantId, ownerUserId?, providerKey, mailbox, nonce} to the
// redirect: the anonymous callback (outside /api/*) trusts only the
// verified state, preventing CSRF and cross-tenant or cross-user claiming
// because an attacker cannot redirect the callback to another tenant or
// user without breaking the signature.
//
// Format: <payload-base64url>.<expiresAtMs>.<hmac-base64url>
// Patterned after auth-email-password/signed-token.ts (HMAC-SHA256, purpose
// in the HMAC input, timing-safe comparison, expiry in the clear-text
// segment).

import { randomUUID } from "node:crypto";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { isPlainObject } from "@cosmicdrift/kumiko-types/type-guards";
import { hmacSignatureMatches, signHmacSha256Base64Url } from "../shared/index.ts";

const STATE_PURPOSE = "inbound-mail-oauth-connect";

export type OAuthStatePayload = {
  readonly tenantId: string;
  /** null = shared mailbox; otherwise this user's personal mailbox. */
  readonly ownerUserId: string | null;
  readonly providerKey: string;
  /** Mailbox address from the connect request; after token exchange, it is
   * stored in the MailAccount. */
  readonly mailbox: string;
  /** One-time nonce makes each state unique, preventing replay across
   * two parallel connect flows. */
  readonly nonce: string;
};

export type VerifyOAuthStateResult =
  | { readonly ok: true; readonly payload: OAuthStatePayload }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function hmacInput(payloadB64: string, expiresAtMs: number): string {
  return `${STATE_PURPOSE}:${payloadB64}.${expiresAtMs}`;
}

export function signOAuthState(
  payload: Omit<OAuthStatePayload, "nonce">,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  const full: OAuthStatePayload = { ...payload, nonce: randomUUID() };
  const payloadB64 = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  const expiresAtMs = now.add({ minutes: ttlMinutes }).epochMilliseconds;
  const signature = signHmacSha256Base64Url(hmacInput(payloadB64, expiresAtMs), secret);
  return `${payloadB64}.${expiresAtMs}.${signature}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): VerifyOAuthStateResult {
  const parts = state.split(".");
  if (parts.length !== 3) return { ok: false, reason: "malformed" };
  const [payloadB64, expiresAtRaw, providedSig] = parts;
  if (!payloadB64 || !expiresAtRaw || !providedSig) return { ok: false, reason: "malformed" };

  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || String(expiresAtMs) !== expiresAtRaw) {
    return { ok: false, reason: "malformed" };
  }

  const expected = signHmacSha256Base64Url(hmacInput(payloadB64, expiresAtMs), secret);
  if (!hmacSignatureMatches(expected, providedSig)) return { ok: false, reason: "bad_signature" };

  if (Temporal.Instant.compare(now, Temporal.Instant.fromEpochMilliseconds(expiresAtMs)) > 0) {
    return { ok: false, reason: "expired" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!isOAuthStatePayload(parsed)) return { ok: false, reason: "malformed" };
  return { ok: true, payload: parsed };
}

function isOAuthStatePayload(v: unknown): v is OAuthStatePayload {
  if (!isPlainObject(v)) return false;
  return (
    typeof v["tenantId"] === "string" &&
    (v["ownerUserId"] === null || typeof v["ownerUserId"] === "string") &&
    typeof v["providerKey"] === "string" &&
    typeof v["mailbox"] === "string" &&
    typeof v["nonce"] === "string"
  );
}
