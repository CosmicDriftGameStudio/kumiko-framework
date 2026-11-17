import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  runnerCanBeginTransaction,
  transaction,
  updateMany,
} from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "@cosmicdrift/kumiko-types/temporal";
import {
  PAT_REVOKED_AGGREGATE_TYPE,
  PAT_REVOKED_EVENT_QN,
  patRevokedSchema,
} from "./pat-revoked-event.ts";
import { apiTokenTable } from "./schema/api-token.ts";

// Cross-tenant revoke: password change and MFA state change are account-level security events.
// Called through the auth-foundation credentialRevoker (password change, MFA state change) and by crypto-shredding forget-subject; the runner is the caller's transaction or a pool.
export async function revokeAllPatTokensForUser(db: DbRunner, userId: string): Promise<number> {
  // Update and event commit together: otherwise a failed append leaves the
  // tokens revoked with no event, and a retry matches no live row.
  // A pool has begin(); a tx/savepoint handle does not and is already atomic.
  return runnerCanBeginTransaction(db)
    ? transaction(db, (tx) => revokeAndAppend(tx, userId))
    : revokeAndAppend(db, userId);
}

async function revokeAndAppend(db: DbRunner, userId: string): Promise<number> {
  const updated = await updateMany<{ id: string }>(
    db,
    apiTokenTable,
    { revokedAt: Temporal.Now.instant() },
    { userId, revokedAt: null },
  );

  // Same reasoning as the sessions revoke append — this raw
  // callback has no dispatcher ctx to call unsafeAppendEvent from, so it
  // uses the low-level append() directly, anchored on SYSTEM_TENANT_ID like
  // sessions' cross-tenant writes. Without it, the access-invalidation
  // consumer never hears about a password-change/MFA-toggle/forget-subject
  // PAT revoke and any already-open SSE stream on those tokens survives it.
  if (updated.length > 0) {
    const payload = patRevokedSchema.parse({
      userId,
      tokenIds: updated.map((row) => row.id),
    });
    await append(db, {
      aggregateId: generateId(),
      aggregateType: PAT_REVOKED_AGGREGATE_TYPE,
      tenantId: SYSTEM_TENANT_ID,
      expectedVersion: 0,
      type: PAT_REVOKED_EVENT_QN,
      payload,
      metadata: { userId },
    });
  }

  return updated.length;
}
