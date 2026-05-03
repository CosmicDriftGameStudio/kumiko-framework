// Redis-backed Token-Store für Tenant-Invite-Magic-Link-Flow.
//
// Subject ist die Invitation-Row-ID (DB-row owner: tenant-feature). Wir
// mappen Token → invitationId in Redis und nutzen den Token als opaque
// random string aus generateToken (256 bit base64url, randomBytes).
//
// Anders als signup-token-store mappen wir hier NICHT bidirektional
// — Resend-Idempotenz lebt auf der Invitation-Row-Ebene (Admin invitet
// dieselbe email zweimal → existing row + token wird re-genutzt; das
// invite-create-handler holt den existing token aus Redis via
// invitationId-Lookup auf einem zweiten Key).
//
// Bidirektional ist trotzdem nützlich für Cancel: Admin cancelt → row.id
// bekannt, ich brauche den token um Redis-Key zu löschen. Daher: zweiter
// Key invite:by-id:<invitationId> → token. Cancel löscht beide.
//
// Bug-Pattern: TTL liegt nur in Redis. DB-row.expiresAt ist UI-Anzeige.
// Bei expired-token: invite-accept findet den Token nicht → invalid-
// invite-token. DB-row bleibt mit status="pending" — Cleanup-Job
// markiert sie zu "expired" (separater Concern, kommt im U.3-Cleanup).
//
// Keine Kollision mit signup/reset/verify-Tokens: alle Invite-Keys haben
// `invite:`-Prefix.

import type Redis from "ioredis";

const TOKEN_KEY_PREFIX = "invite:by-token:";
const ID_KEY_PREFIX = "invite:by-id:";
const BURN_KEY_PREFIX = "invite:burn:";

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${token}`;
}
function idKey(invitationId: string): string {
  return `${ID_KEY_PREFIX}${invitationId}`;
}
function burnKey(token: string): string {
  return `${BURN_KEY_PREFIX}${token}`;
}

/** Speichert das Pair bidirektional und setzt TTL auf beiden Keys.
 *  Idempotent — re-write derselben Token-Invitation-Kombi ist OK
 *  (refresh TTL für Resend). */
export async function storeInviteToken(
  redis: Redis,
  args: { invitationId: string; token: string; ttlSeconds: number },
): Promise<void> {
  await Promise.all([
    redis.set(tokenKey(args.token), args.invitationId, "EX", args.ttlSeconds),
    redis.set(idKey(args.invitationId), args.token, "EX", args.ttlSeconds),
  ]);
}

/** Lookup: invitationId für Token. Null wenn Token nicht (mehr) existiert
 *  (abgelaufen, schon konsumiert, oder ungültig). */
export async function getInvitationIdForToken(
  redis: Redis,
  token: string,
): Promise<string | null> {
  return redis.get(tokenKey(token));
}

/** Lookup: Existierender Token für eine invitationId — für Resend-
 *  Idempotenz (Admin invitet dieselbe email zweimal → re-use token). */
export async function getTokenForInvitation(
  redis: Redis,
  invitationId: string,
): Promise<string | null> {
  return redis.get(idKey(invitationId));
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
