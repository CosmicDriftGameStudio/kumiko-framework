// Redis-backed token store for the tenant-invite magic-link flow.
//
// Subject is the invitation row ID (DB-row owner: tenant-feature). The
// store mechanics (bidirectional token↔subject mapping, sha256-hashed
// keys, single-use burn) live in shared/single-use-token-store.ts — this
// file only wires the invite key prefixes onto it.
//
// Unlike signup-token-store we don't rely on the store's reverse lookup for
// reuse-detection: resend-idempotency lives at the invitation-row level (an
// admin inviting the same email twice reuses the existing row and mints a
// fresh token; invite-create looks up the *previous* token's hash via the
// by-id entry to invalidate it before storing the new one). The by-id entry
// is still useful for cancel: the admin knows row.id and needs the forward
// key to delete it.
//
// Bug pattern: TTL lives only in Redis. DB-row.expiresAt is UI display
// only. On an expired token, invite-accept doesn't find it → invalid-
// invite-token. The DB row stays status="pending" — a cleanup job marks it
// "expired" (separate concern, tracked in U.3-cleanup).
//
// No collision with signup/reset/verify tokens: all invite keys carry the
// `invite:`-prefix.

import type Redis from "ioredis";
import { createSingleUseTokenStore } from "../shared/single-use-token-store";

const store = createSingleUseTokenStore({
  tokenPrefix: "invite:by-token:",
  subjectPrefix: "invite:by-id:",
  burnPrefix: "invite:burn:",
});

/** Stores the pair bidirectionally and sets TTL on both keys.
 *  Idempotent — re-writing the same token-invitation pair is fine
 *  (refreshes the TTL for resend). */
export async function storeInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string; ttlSeconds: number },
): Promise<void> {
  return store.store(redis, {
    subjectId: args.invitationId,
    token: args.token,
    ttlSeconds: args.ttlSeconds,
  });
}

/** Lookup: invitationId for a token. Null if the token no longer exists
 *  (expired, already consumed, or invalid). */
export const getInvitationIdForToken = store.getSubjectForToken;

/** Deletes a still-live invite token for this invitation, if one exists.
 *  Two callers: invite-create on every resend (a fresh token + by-id entry
 *  follows right after, so this is "at most one live token per
 *  invitation"), and cancel-invitation (no replacement follows, so this is
 *  full cleanup). */
export async function invalidateExistingInviteToken(
  redis: Redis,
  invitationId: string,
): Promise<boolean> {
  return store.invalidateExistingBySubject(redis, invitationId);
}

/** Single-use burn. If two tabs click the accept link at the same time,
 *  the first one wins, the second gets "already-used". TTL = 1h. */
export const burnInviteToken = store.burn;

/** Cleanup after a successful accept OR cancel — deletes both lookup
 *  keys. The burn key stays for the remaining burn TTL as replay protection. */
export async function deleteInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string },
): Promise<void> {
  return store.deleteBoth(redis, { subjectId: args.invitationId, token: args.token });
}

/** Burn release for failed-accept paths (DB error etc.) so a legitimate
 *  retry isn't blocked by a stale burn marker. */
export const unburnInviteToken = store.unburn;
