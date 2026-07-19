// HMAC-signierter OAuth-`state`-Parameter für den Connect-Flow.
//
// Bindet {tenantId, ownerUserId?, providerKey, mailbox, nonce} an den
// Redirect: der anonyme Callback (außerhalb /api/*) vertraut NUR dem
// verifizierten state — verhindert CSRF und Fremd-Claiming (ein
// Angreifer kann den Callback nicht auf einen fremden Tenant/User
// umbiegen, ohne die Signatur zu brechen).
//
// Format: <payload-base64url>.<expiresAtMs>.<hmac-base64url>
// Muster: auth-email-password/signed-token.ts (HMAC-SHA256, purpose im
// HMAC-Input, timing-safe compare, Expiry im Klartext-Segment).

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { Temporal } from "temporal-polyfill";

const STATE_PURPOSE = "inbound-mail-oauth-connect";

export type OAuthStatePayload = {
  readonly tenantId: string;
  /** null = shared-Postfach, sonst persönliches Postfach dieses Users. */
  readonly ownerUserId: string | null;
  readonly providerKey: string;
  /** Postfach-Adresse aus dem Connect-Request — landet nach dem
   *  Token-Exchange im MailAccount. */
  readonly mailbox: string;
  /** Einmal-Nonce — macht jeden state einzigartig (kein Replay über
   *  zwei parallele Connect-Flows hinweg). */
  readonly nonce: string;
};

export type VerifyOAuthStateResult =
  | { readonly ok: true; readonly payload: OAuthStatePayload }
  | { readonly ok: false; readonly reason: "malformed" | "bad_signature" | "expired" };

function sign(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

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
  const signature = sign(hmacInput(payloadB64, expiresAtMs), secret);
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

  const expected = sign(hmacInput(payloadB64, expiresAtMs), secret);
  const expectedBuf = Buffer.from(expected, "base64url");
  const providedBuf = Buffer.from(providedSig, "base64url");
  // Length-check VOR timingSafeEqual — die würde bei Längen-Mismatch
  // werfen, und der Throw selbst leakt via Timing.
  if (expectedBuf.length !== providedBuf.length) return { ok: false, reason: "bad_signature" };
  if (!timingSafeEqual(expectedBuf, providedBuf)) return { ok: false, reason: "bad_signature" };

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
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o["tenantId"] === "string" &&
    (o["ownerUserId"] === null || typeof o["ownerUserId"] === "string") &&
    typeof o["providerKey"] === "string" &&
    typeof o["mailbox"] === "string" &&
    typeof o["nonce"] === "string"
  );
}
