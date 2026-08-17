// Redis-backed pre-activation token store for magic-link signup.
//
// Token material: opaque random 256-bit from crypto.randomBytes (see
// signup-request.write.ts → generateToken() from framework/api),
// base64url-encoded to 43 chars. Not designed for human typing — the
// user clicks the mail link, nobody types the token.
//
// Unlike reset/verify tokens (HMAC-signed, statelessly verifiable),
// signup tokens need a server-side lookup: the user doesn't exist yet,
// so there's no userId claim for the HMAC to bind to. We map token ↔
// email bidirectionally in Redis and delete the pair on confirm.
// Bidirectional because:
//   - by-token: confirm-handler needs token → email
//   - by-email: signup-request needs to know whether a token is still
//     live for this email, so a resend can invalidate it instead of
//     leaving two valid tokens for the same signup around
//
// Every key is derived from sha256(token), never the raw token —
// Redis key names, MONITOR output, replica traffic, and memory/backup
// dumps never carry the bearer secret in the clear (#2174). The
// by-email entry stores the *hash* of the live token, not the token
// itself, so it can only be used to invalidate (delete the matching
// forward entry) — never to recover or resend the original token. A
// resend therefore always mints a fresh token and invalidates the
// previous one, rather than reusing the same link.
//
// No collision with reset/verify tokens: all signup keys carry the
// `signup:`-prefix.

import { createHash } from "node:crypto";
import type Redis from "ioredis";

const TOKEN_KEY_PREFIX = "signup:by-token:";
const EMAIL_KEY_PREFIX = "signup:by-email:";
const BURN_KEY_PREFIX = "signup:burn:";

/** Email-Normalisierung — single source für jede Lookup-Schicht (Store
 *  intern UND Caller die im Return-Body / Mail-Send eine konsistente
 *  Form brauchen). Vorher zwei Stellen mit `.toLowerCase()` — eine
 *  Quelle = kein Drift. */
export function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

// Same sha256-hex pattern as hashPatToken (personal-access-tokens/hash.ts)
// and preauthTokenKeyOf (framework/api/auth-routes.ts): the token is
// high-entropy, so a single fast hash is enough — no brute-force surface
// that would justify a slow password-hash.
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${hashToken(token)}`;
}
// Builds the forward key from an already-hashed value (e.g. read back from
// the by-email entry) — does NOT hash again. Keeping this separate from
// tokenKey() (which hashes a raw token) makes a double-hash mistake visible
// at the call site instead of silently no-op'ing a delete.
function forwardKeyForHash(tokenHash: string): string {
  return `${TOKEN_KEY_PREFIX}${tokenHash}`;
}
// @wrapper-known semantic-alias
function emailKey(email: string): string {
  return `${EMAIL_KEY_PREFIX}${normalizeEmail(email)}`;
}
function burnKey(token: string): string {
  return `${BURN_KEY_PREFIX}${hashToken(token)}`;
}

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Email-Kombi ist OK. The
 *  by-email value is the token's hash, not the token — see file header. */
export async function storeSignupToken(
  redis: Redis,
  args: { email: string; token: string; ttlSeconds: number },
): Promise<void> {
  await Promise.all([
    redis.set(tokenKey(args.token), normalizeEmail(args.email), "EX", args.ttlSeconds),
    redis.set(emailKey(args.email), hashToken(args.token), "EX", args.ttlSeconds),
  ]);
}

/** Lookup: Email für einen Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
export async function getEmailForSignupToken(redis: Redis, token: string): Promise<string | null> {
  return redis.get(tokenKey(token));
}

/** Deletes a still-live signup token for this email, if one exists — both
 *  the forward entry (built from the hash already stored in the by-email
 *  entry, never recovers the raw token) and the by-email entry itself.
 *  Returns whether a live token existed. Used by signup-request on every
 *  request; a fresh token + by-email entry follows right after, so this
 *  is "at most one live token per email." Deleting the by-email entry
 *  here too (not just the forward key) avoids leaving a dangling hash
 *  pointing at nothing if the request crashes before storeSignupToken. */
export async function invalidateExistingSignupToken(redis: Redis, email: string): Promise<boolean> {
  const existingHash = await redis.get(emailKey(email));
  if (existingHash === null) return false;
  await Promise.all([redis.del(forwardKeyForHash(existingHash)), redis.del(emailKey(email))]);
  return true;
}

/** Single-Use-Burn: wenn zwei Tabs gleichzeitig den Confirm-Link klicken,
 *  gewinnt der erste, der zweite kriegt "already-used". TTL = 1 Stunde
 *  (kurz genug damit der Burn-Key Redis nicht dauerhaft belastet, lang
 *  genug damit Replays in normalen Race-Windows abgefangen werden). */
export async function burnSignupToken(
  redis: Redis,
  token: string,
): Promise<"burned" | "already-used"> {
  // SET NX EX — atomic check-and-set. Returnt "OK" wenn Key neu, null
  // wenn schon da.
  const result = await redis.set(burnKey(token), "1", "EX", 3600, "NX");
  return result === "OK" ? "burned" : "already-used";
}

/** Cleanup nach erfolgreichem Confirm — beide Lookup-Keys löschen.
 *  Burn-Key bleibt (verhindert Replay innerhalb der Burn-TTL). */
export async function deleteSignupToken(
  redis: Redis,
  args: { email: string; token: string },
): Promise<void> {
  await Promise.all([redis.del(tokenKey(args.token)), redis.del(emailKey(args.email))]);
}

/** Burn-Release für Failed-Confirm-Pfade (DB-Error etc.) damit ein
 *  legitimer Retry nicht durch einen stale Burn-Marker geblockt wird. */
export async function unburnSignupToken(redis: Redis, token: string): Promise<void> {
  await redis.del(burnKey(token));
}
