// Redis-backed Pre-Activation-Token-Store für Magic-Link-Signup.
//
// Token-Material: opaque random 256-bit aus crypto.randomBytes
// (siehe signup-request.write.ts → generateToken() aus framework/api).
// Base64url-codiert zu 43 chars. NICHT no-confusable und NICHT für
// menschliches Tippen — der User klickt den Mail-Link, niemand tippt
// den Token ab.
//
// Anders als reset/verify-Tokens (HMAC-signed, stateless verifizierbar)
// brauchen Signup-Tokens einen serverside Lookup: der User existiert
// noch nicht, also gibt's keinen userId-claim den der HMAC binden
// könnte. Wir mappen daher Token ↔ Email bidirektional in Redis und
// löschen das Pair beim Confirm. Bidirektional weil:
//   - by-token: confirm-handler braucht Token → Email
//   - by-email: signup-request muss bei Resend einen existierenden
//     Token wiederverwenden statt einen zweiten parallel laufen zu
//     lassen (sonst hätte der User zwei Mails mit zwei verschiedenen
//     Tokens, beide gültig, beide könnten zu zwei separaten Tenants
//     führen wenn er beide klickt — unnötiges Risiko)
//
// TTL-Refresh bei Resend: wenn der Token noch lebt, refreshen wir
// einfach beide Keys auf die volle TTL — der User bekommt eine neue
// Mail mit dem GLEICHEN Token, alte Mail bleibt gültig (idempotent
// für den User).
//
// Keine Kollision mit reset/verify-Tokens: alle Signup-Keys haben
// `signup:`-Prefix.

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

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${token}`;
}
// @wrapper-known semantic-alias
function emailKey(email: string): string {
  return `${EMAIL_KEY_PREFIX}${normalizeEmail(email)}`;
}
function burnKey(token: string): string {
  return `${BURN_KEY_PREFIX}${token}`;
}

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Email-Kombi ist OK. */
export async function storeSignupToken(
  redis: Redis,
  args: { email: string; token: string; ttlSeconds: number },
): Promise<void> {
  await Promise.all([
    redis.set(tokenKey(args.token), normalizeEmail(args.email), "EX", args.ttlSeconds),
    redis.set(emailKey(args.email), args.token, "EX", args.ttlSeconds),
  ]);
}

/** Lookup: Email für einen Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
export async function getEmailForSignupToken(redis: Redis, token: string): Promise<string | null> {
  return redis.get(tokenKey(token));
}

/** Lookup: Existierenden Token für eine Email — falls noch valid und
 *  noch nicht konsumiert. Für Resend-Idempotenz im signup-request-Handler. */
export async function getTokenForSignupEmail(redis: Redis, email: string): Promise<string | null> {
  return redis.get(emailKey(email));
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
