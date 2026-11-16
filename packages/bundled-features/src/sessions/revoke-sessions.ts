import { type DbRunner, updateMany, type WhereObject } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append, type EventMetadata } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import type { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import { userSessionTable } from "./schema/user-session.ts";
import {
  SESSION_REVOKED_AGGREGATE_TYPE,
  SESSION_REVOKED_EVENT_QN,
  type SessionRevokedPayload,
  sessionRevokedSchema,
} from "./session-revoked-event.ts";

export type SessionRevocation = {
  // Without revokedAt: the helper adds it so already-revoked rows keep their original timestamp.
  readonly where: WhereObject;
  readonly revokedAt: Temporal.Instant;
  readonly keptSessionId?: string;
  readonly streamScope?: SessionRevokedPayload["streamScope"];
  readonly eventVersion?: number;
  readonly metadata?: EventMetadata;
};

// Stamps revokedAt on the matching live rows and announces them on the SYSTEM stream, so the
// access-invalidation consumer closes their SSE streams. The caller passes one transaction so a
// failed append rolls the revoke back and a retry still finds the rows live.
export async function revokeSessionsAndAnnounce(
  runner: DbRunner,
  revocation: SessionRevocation,
): Promise<readonly string[]> {
  const revoked = await updateMany<{ id: string; userId: string }>(
    runner,
    userSessionTable,
    { revokedAt: revocation.revokedAt },
    { ...revocation.where, revokedAt: null },
  );
  const first = revoked[0];
  if (!first) return [];
  const sessionIds = revoked.map((row) => row.id);
  const payload = sessionRevokedSchema.parse({
    userId: first.userId,
    sessionIds,
    ...(revocation.keptSessionId !== undefined && { keptSessionId: revocation.keptSessionId }),
    ...(revocation.streamScope !== undefined && { streamScope: revocation.streamScope }),
  });
  await append(runner, {
    aggregateId: generateId(),
    aggregateType: SESSION_REVOKED_AGGREGATE_TYPE,
    tenantId: SYSTEM_TENANT_ID,
    expectedVersion: 0,
    type: SESSION_REVOKED_EVENT_QN,
    ...(revocation.eventVersion !== undefined && { eventVersion: revocation.eventVersion }),
    payload,
    metadata: revocation.metadata ?? { userId: first.userId },
  });
  return sessionIds;
}
