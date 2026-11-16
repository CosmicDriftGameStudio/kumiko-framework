// HMAC-signed OAuth-`state` parameter for the connect flow.
//
// Binds {tenantId, ownerUserId?, providerKey, mailbox, browserBinding} to the
// redirect: the anonymous callback (outside /api/*) trusts only the
// verified state, preventing CSRF and cross-tenant or cross-user claiming
// because an attacker cannot redirect the callback to another tenant or
// user without breaking the signature.
// The state is not single-use: the provider's authorization code is. browserBinding ties the state to the browser that started the flow, so a state link completed in another browser (login CSRF that would put the victim's mailbox into the attacker's account) is refused.
//
// Format: <payload-base64url>.<expiresAtMs>.<hmac-base64url>
// Patterned after auth-email-password/signed-token.ts (HMAC-SHA256, purpose
// in the HMAC input, timing-safe comparison, expiry in the clear-text
// segment).

import { createHash } from "node:crypto";
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
  /** SHA-256 (base64url) of the HttpOnly cookie the connect route set in the starting browser. */
  readonly browserBinding: string;
};

export const OAUTH_BROWSER_BINDING_COOKIE = "kumiko_inbound_mail_oauth";

// Only the digest travels in the state, which passes through the provider's URLs and logs.
export function oauthBrowserBinding(cookieValue: string): string {
  return createHash("sha256").update(cookieValue).digest("base64url");
}

export type VerifyOAuthStateResult =
  | { readonly ok: true; readonly payload: OAuthStatePayload }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function hmacInput(payloadB64: string, expiresAtMs: number): string {
  return `${STATE_PURPOSE}:${payloadB64}.${expiresAtMs}`;
}

export function signOAuthState(
  payload: OAuthStatePayload,
  ttlMinutes: number,
  secret: string,
  now: Temporal.Instant = Temporal.Now.instant(),
): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
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
    typeof v["browserBinding"] === "string"
  );
}
