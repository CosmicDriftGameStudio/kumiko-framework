// Generic Redis-backed pre-activation token store: bidirectional
// token↔subject mapping plus single-use burn/unburn semantics. Extracted
// from auth-email-password/signup-token-store.ts and
// auth-email-password/invite-token-store.ts (infra#2999) — both were the
// same Redis layout, differing only in their key prefixes and which field
// (email vs. invitationId) plays the "subject" role.
//
// Public subpath export (./shared/single-use-token-store in package.json):
// offlot-app (a separate repo, external consumer) carries its own copy of
// this exact logic under `src/features/waitlist/signup-token-store.ts`,
// with a comment noting it "must stay byte-compatible with
// auth-email-password/signup-token-store" because signup-confirm resolves
// tokens via the same Redis key layout. offlot-app#418 (separate issue,
// after this ships) will replace that copy with
// `createSingleUseTokenStore({ tokenPrefix: "signup:by-token:", subjectPrefix:
// "signup:by-email:", burnPrefix: "signup:burn:" })` — i.e. the exact same
// prefix strings the framework's own signup store below uses, so both stay
// byte-compatible by construction instead of by hand-copied logic.
//
// Token material: opaque random 256-bit (e.g. crypto.randomBytes,
// base64url-encoded). Not designed for human typing — the subject clicks a
// mail link, nobody types the token.
//
// Why a server-side lookup at all (not a stateless HMAC-signed token, like
// password-reset/email-verification)? Some subjects (e.g. a not-yet-created
// signup) have no stable identity claim yet for an HMAC to bind to. We map
// token ↔ subject bidirectionally in Redis and delete the pair on confirm.
// Bidirectional because:
//   - forward (by-token): confirm/accept needs token → subject
//   - reverse (by-subject): the create/request flow needs to know whether a
//     token is still live for this subject, so a resend can invalidate it
//     instead of leaving two valid tokens around
//
// Every key is derived from sha256(token), never the raw token — Redis key
// names, MONITOR output, replica traffic, and memory/backup dumps never
// carry the bearer secret in the clear (#2174). The by-subject entry stores
// the *hash* of the live token, not the token itself, so it can only be
// used to invalidate (delete the matching forward entry) — never to
// recover or resend the original token. A resend therefore always mints a
// fresh token and invalidates the previous one, rather than reusing the
// same link.
//
// Single-use burn: `SET burn:<hash> "1" EX 3600 NX` — first caller to
// confirm/accept wins ("OK"), a concurrent second tab racing the same link
// gets "already-used". TTL is 1h (short enough that the burn-key doesn't
// permanently tax Redis, long enough to catch replays inside any realistic
// race window).

import { createHash } from "node:crypto";
import type Redis from "ioredis";

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function createSingleUseTokenStore(prefixes: {
  readonly tokenPrefix: string;
  readonly subjectPrefix: string;
  readonly burnPrefix: string;
}) {
  function tokenKey(token: string): string {
    return `${prefixes.tokenPrefix}${hashToken(token)}`;
  }
  // Builds the forward key from an already-hashed value (e.g. read back
  // from the by-subject entry) — does NOT hash again. Kept separate from
  // tokenKey() (which hashes a raw token) so a double-hash mistake is
  // visible at the call site instead of silently no-op'ing a delete.
  function forwardKeyForHash(tokenHash: string): string {
    return `${prefixes.tokenPrefix}${tokenHash}`;
  }
  function subjectKey(subjectId: string): string {
    return `${prefixes.subjectPrefix}${subjectId}`;
  }
  function burnKey(token: string): string {
    return `${prefixes.burnPrefix}${hashToken(token)}`;
  }

  // Stores the pair bidirectionally and sets TTL on both keys. Idempotent —
  // re-writing the same token/subject pair is fine. The by-subject value is
  // the token's hash, not the token — see file header.
  async function store(
    redis: Redis,
    args: { subjectId: string; token: string; ttlSeconds: number },
  ): Promise<void> {
    await Promise.all([
      redis.set(tokenKey(args.token), args.subjectId, "EX", args.ttlSeconds),
      redis.set(subjectKey(args.subjectId), hashToken(args.token), "EX", args.ttlSeconds),
    ]);
  }

  // Lookup: subject for a token. Null when the token doesn't (or no longer)
  // exist (expired, already consumed, or invalid).
  async function getSubjectForToken(redis: Redis, token: string): Promise<string | null> {
    return redis.get(tokenKey(token));
  }

  // Deletes a still-live token for this subject, if one exists — both the
  // forward entry (built from the hash already stored in the by-subject
  // entry, never recovers the raw token) and the by-subject entry itself.
  // Returns whether a live token existed. Deleting the by-subject entry
  // here too (not just the forward key) avoids leaving a dangling hash
  // pointing at nothing if the caller crashes before the following store().
  async function invalidateExistingBySubject(redis: Redis, subjectId: string): Promise<boolean> {
    const existingHash = await redis.get(subjectKey(subjectId));
    if (existingHash === null) return false;
    await Promise.all([
      redis.del(forwardKeyForHash(existingHash)),
      redis.del(subjectKey(subjectId)),
    ]);
    return true;
  }

  // SET NX EX — atomic check-and-set. Returns "OK" when the key is new,
  // null when it's already there.
  async function burn(redis: Redis, token: string): Promise<"burned" | "already-used"> {
    const result = await redis.set(burnKey(token), "1", "EX", 3600, "NX");
    return result === "OK" ? "burned" : "already-used";
  }

  // Cleanup after a successful confirm/accept — both lookup keys. The
  // burn-key stays (prevents a replay for the rest of the burn TTL).
  async function deleteBoth(
    redis: Redis,
    args: { subjectId: string; token: string },
  ): Promise<void> {
    await Promise.all([redis.del(tokenKey(args.token)), redis.del(subjectKey(args.subjectId))]);
  }

  // Burn-release for a failed confirm/accept path (e.g. a DB error) so a
  // legitimate retry isn't blocked by a stale burn marker.
  async function unburn(redis: Redis, token: string): Promise<void> {
    await redis.del(burnKey(token));
  }

  return { store, getSubjectForToken, invalidateExistingBySubject, burn, deleteBoth, unburn };
}
