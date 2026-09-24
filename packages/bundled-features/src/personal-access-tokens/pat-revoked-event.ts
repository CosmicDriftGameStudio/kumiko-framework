import * as z from "zod";

// Lightweight custom event appended alongside the direct-write updateMany()
// in revoke.write.ts / revoke-for-user.ts (mirrors sessions'
// session-revoked-event.ts). apiTokenTable itself stays an unmanaged
// direct-write store (see feature.ts) — this event is NOT a CRUD/lifecycle
// event for that table and carries no projection. Its only job is to give
// the access-invalidation consumer something to LISTEN for, keyed by the
// affected userId, so a revoked PAT's open SSE stream closes.
export const PAT_REVOKED_EVENT_SHORT = "pat-revoked" as const;
export const PAT_REVOKED_EVENT_QN = "personal-access-tokens:event:pat-revoked" as const;

// Own aggregate type, decoupled from apiTokenEntity's implicit
// "api-token" — each revoke action mints a fresh aggregate id (no
// predecessor to satisfy, no version_conflict against concurrent revokes).
export const PAT_REVOKED_AGGREGATE_TYPE = "api-token-revocation" as const;

export const patRevokedSchema = z.object({
  userId: z.string().min(1),
  tokenIds: z.array(z.uuid()).min(1),
});

export type PatRevokedPayload = z.infer<typeof patRevokedSchema>;
