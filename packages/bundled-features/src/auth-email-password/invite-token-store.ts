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

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Invitation-Kombi ist OK
 *  (refresh TTL für Resend). */
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

/** Lookup: invitationId für Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
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

/** Single-Use-Burn. Wenn zwei Tabs gleichzeitig den Accept-Link klicken,
 *  gewinnt der erste, der zweite kriegt "already-used". TTL = 1h. */
export const burnInviteToken = store.burn;

/** Cleanup nach erfolgreichem Accept ODER Cancel — beide Lookup-Keys
 *  löschen. Burn-Key bleibt für die restliche Burn-TTL als Replay-Schutz. */
export async function deleteInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string },
): Promise<void> {
  return store.deleteBoth(redis, { subjectId: args.invitationId, token: args.token });
}

/** Burn-Release für Failed-Accept-Pfade (DB-Error etc.) damit ein
 *  legitimer Retry nicht durch einen stale Burn-Marker geblockt wird. */
export const unburnInviteToken = store.unburn;
