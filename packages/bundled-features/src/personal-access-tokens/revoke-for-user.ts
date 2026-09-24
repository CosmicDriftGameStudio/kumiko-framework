import { updateMany } from "@cosmicdrift/kumiko-framework/bun-db";
import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import { SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { append } from "@cosmicdrift/kumiko-framework/event-store";
import { generateId } from "@cosmicdrift/kumiko-framework/utils";
import { Temporal } from "temporal-polyfill";
import {
  PAT_REVOKED_AGGREGATE_TYPE,
  PAT_REVOKED_EVENT_QN,
  patRevokedSchema,
} from "./pat-revoked-event";
import { apiTokenTable } from "./schema/api-token";

// Cross-tenant revoke: password-change and MFA-enable/disable are account-
// level security events, not scoped to one tenant. Mirrors sessions'
// sessionMassRevoker (session-callbacks.ts) which passes the boot-time
// DbConnection directly — not ctx.db, which would be tenant-scoped in a hook.
export async function revokeAllPatTokensForUser(db: DbRunner, userId: string): Promise<number> {
  const updated = await updateMany<{ id: string }>(
    db,
    apiTokenTable,
    { revokedAt: Temporal.Now.instant() },
    { userId, revokedAt: null },
  );

  // Same reasoning as sessionMassRevoker's append — this raw
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
