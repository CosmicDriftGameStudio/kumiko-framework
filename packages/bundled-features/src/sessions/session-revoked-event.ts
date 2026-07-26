import { z } from "zod";

// Lightweight custom event appended alongside the direct-write
// updateMany() in revoke.write.ts / revoke-all-others.write.ts /
// revoke-all-for-user.write.ts (#1559). store_user_sessions itself stays
// an unmanaged direct-write store (see feature.ts) — the row columns are
// the audit trail, this event is NOT a CRUD/lifecycle event for that
// table and carries no projection. Its only job is to give cross-instance
// consumers (access-invalidation, #1560) something to LISTEN for via the
// existing event-store NOTIFY, keyed by the affected userId.
//
// _SHORT/_QN pair mirrors cap-counter's rolling-incremented event:
//   _SHORT — r.defineEvent(short, schema) in feature.ts, framework prefixes
//            it to the QN below.
//   _QN    — ctx.unsafeAppendEvent({ type }) / raw append()'s `type` field.
export const SESSION_REVOKED_EVENT_SHORT = "session-revoked" as const;
export const SESSION_REVOKED_EVENT_QN = "sessions:event:session-revoked" as const;

// Own aggregate type, decoupled from userSessionEntity's implicit
// "user-session" — each revoke action mints a fresh aggregate id (no
// predecessor to satisfy, no version_conflict against concurrent revokes).
export const SESSION_REVOKED_AGGREGATE_TYPE = "user-session-revocation" as const;

export const sessionRevokedSchema = z.object({
  userId: z.string().min(1),
  sessionIds: z.array(z.uuid()).min(1),
});

export type SessionRevokedPayload = z.infer<typeof sessionRevokedSchema>;
