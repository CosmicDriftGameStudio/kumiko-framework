// Redis-backed token store for the tenant-invite magic-link flow.
//
// Subject is the invitation row ID (DB-row owner: tenant-feature). We
// map token → invitationId in Redis, using the token as an opaque
// random string from generateToken (256-bit base64url, randomBytes).
//
// Unlike signup-token-store we don't map bidirectionally for reuse —
// resend-idempotency lives at the invitation-row level (an admin
// inviting the same email twice reuses the existing row and mints a
// fresh token; invite-create looks up the *previous* token's hash via
// a second key to invalidate it before storing the new one).
//
// Bidirectional is still useful for cancel: the admin knows row.id and
// needs the forward key to delete. Hence a second key,
// invite:by-id:<invitationId>, holding the hash of the live token.
// Cancel deletes both.
//
// Every key is derived from sha256(token), never the raw token —
// Redis key names, MONITOR output, replica traffic, and memory/backup
// dumps never carry the bearer secret in the clear (#2174). The
// by-id entry stores the *hash* of the live token, not the token
// itself, so it can only be used to invalidate — never to recover or
// resend the original token. A resend therefore always mints a fresh
// token and invalidates the previous one, rather than reusing the
// same link.
//
// Bug pattern: TTL lives only in Redis. DB-row.expiresAt is UI display
// only. On an expired token, invite-accept doesn't find it → invalid-
// invite-token. The DB row stays status="pending" — a cleanup job
// marks it "expired" (separate concern, tracked in U.3-cleanup).
//
// No collision with signup/reset/verify tokens: all invite keys carry
// the `invite:`-prefix.

import { createHash } from "node:crypto";
import type Redis from "ioredis";

const TOKEN_KEY_PREFIX = "invite:by-token:";
const ID_KEY_PREFIX = "invite:by-id:";
const BURN_KEY_PREFIX = "invite:burn:";

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
// the by-id entry) — does NOT hash again. Keeping this separate from
// tokenKey() (which hashes a raw token) makes a double-hash mistake visible
// at the call site instead of silently no-op'ing a delete.
function forwardKeyForHash(tokenHash: string): string {
  return `${TOKEN_KEY_PREFIX}${tokenHash}`;
}
function idKey(invitationId: string): string {
  return `${ID_KEY_PREFIX}${invitationId}`;
}
function burnKey(token: string): string {
  return `${BURN_KEY_PREFIX}${hashToken(token)}`;
}

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Invitation-Kombi ist OK
 *  (refresh TTL für Resend). The by-id value is the token's hash, not
 *  the token — see file header. */
export async function storeInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string; ttlSeconds: number },
): Promise<void> {
  await Promise.all([
    redis.set(tokenKey(args.token), args.invitationId, "EX", args.ttlSeconds),
    redis.set(idKey(args.invitationId), hashToken(args.token), "EX", args.ttlSeconds),
  ]);
}

/** Lookup: invitationId für Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
export async function getInvitationIdForToken(redis: Redis, token: string): Promise<string | null> {
  return redis.get(tokenKey(token));
}

/** Deletes a still-live invite token for this invitation, if one exists —
 *  both the forward entry (built from the hash stored in the by-id entry,
 *  never the raw token) and the by-id entry itself. Returns whether a live
 *  token existed. Two callers: invite-create on every resend (a fresh
 *  token + by-id entry follows right after, so this is "at most one live
 *  token per invitation"), and cancel-invitation (no replacement follows,
 *  so this is full cleanup). */
export async function invalidateExistingInviteToken(
  redis: Redis,
  invitationId: string,
): Promise<boolean> {
  const existingHash = await redis.get(idKey(invitationId));
  if (existingHash === null) return false;
  await Promise.all([redis.del(forwardKeyForHash(existingHash)), redis.del(idKey(invitationId))]);
  return true;
}

/** Single-Use-Burn. Wenn zwei Tabs gleichzeitig den Accept-Link klicken,
 *  gewinnt der erste, der zweite kriegt "already-used". TTL = 1h. */
export async function burnInviteToken(
  redis: Redis,
  token: string,
): Promise<"burned" | "already-used"> {
  const result = await redis.set(burnKey(token), "1", "EX", 3600, "NX");
  return result === "OK" ? "burned" : "already-used";
}

/** Cleanup nach erfolgreichem Accept ODER Cancel — beide Lookup-Keys
 *  löschen. Burn-Key bleibt für die restliche Burn-TTL als Replay-Schutz. */
export async function deleteInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string },
): Promise<void> {
  await Promise.all([redis.del(tokenKey(args.token)), redis.del(idKey(args.invitationId))]);
}

/** Burn-Release für Failed-Accept-Pfade (DB-Error etc.) damit ein
 *  legitimer Retry nicht durch einen stale Burn-Marker geblockt wird. */
export async function unburnInviteToken(redis: Redis, token: string): Promise<void> {
  await redis.del(burnKey(token));
}
