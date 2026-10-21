import type { DbRunner } from "@cosmicdrift/kumiko-framework/db";
import {
  createEventStoreExecutor,
  createTenantDb,
  selectMany,
  type WritePurpose,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, SYSTEM_TENANT_ID } from "@cosmicdrift/kumiko-framework/engine";
import { InternalError } from "@cosmicdrift/kumiko-framework/errors";
import { USER_STATUS, userEntity, userTable } from "../../user/index.ts";

// Lifecycle mutations of the user entity MUST be emitted as `user.updated` events.
// Writing them directly with updateMany causes a read_users rebuild to erase them
// (it replays only `user.created`, so status falls back to its default;
// gracePeriodEnd/pendingDeletionRequestId/Deleted are lost, causing GDPR data loss).
//
// The event MUST use the same (tenant_id, aggregate_id) stream as `user.created`,
// otherwise the aggregate is split across tenants and cannot be reconstructed.
// The user entity runs under `r.systemScope()`, but its events use a concrete
// tenant stream (see auth-email-password/stream-tenant.ts). Therefore, rescope to
// the user's stream tenant—the tenant of the `user.created` event—not
// `event.user.tenantId`, which is the active tenant at lifecycle time and may differ.
const userExecutor = createEventStoreExecutor(userTable, userEntity, { entityName: "user" });

export type UpdateUserLifecycleOptions = {
  // Declarative "genau einmal"-precondition: the update only applies if the row
  // still holds these field values at write time. Forwarded as-is to the
  // executor's `expect:`. Omitted: unconditional overwrite (skipOptimisticLock).
  // Scalars only, see the executor's `expect:` doc.
  readonly expect?: Readonly<Record<string, string | number | boolean | null>>;
  // Erasure flows run after the subject key is erased; the write then stores the
  // erased sentinel instead of failing on re-encrypt.
  readonly writePurpose?: WritePurpose;
  // Also address a row the stream has already soft-deleted. Only erasure needs
  // this: a deleted stream with a still-`active` status must still get its
  // status event so the login door closes.
  readonly includeDeleted?: boolean;
};

// `conn` is ctx.db.unsafeRaw() (regular handlers) or the open tx
// (forget-cleanup sub-tx) — keeps the event append atomic with the write.
//
// Returns `{ applied: false }` instead of throwing only when `options.expect`
// was set AND the executor rejected the write because the precondition no
// longer held (precondition_failed) or a concurrent writer won the race on
// the same stream version (version_conflict) — both mean "someone else's
// transition already landed", the expected outcome for a caller that opted
// into `expect`. Any other failure, or a failure with no `expect` set, still
// throws — those callers never checked a return value, so silently dropping
// their write would be silent data loss.
export async function updateUserLifecycle(
  conn: DbRunner,
  userId: string,
  changes: Record<string, unknown>,
  options?: UpdateUserLifecycleOptions,
): Promise<{ readonly applied: boolean }> {
  // The user is a system stream: the executor choke point always addresses the
  // stream through SYSTEM_TENANT_ID; rescoping to row-tenant_id would have no
  // effect. Use "system" mode so loadById also finds legacy rows whose tenant_id
  // predates the backfill rebuild.
  // skipOptimisticLock: every caller is a server-side business transition
  // (restrict/lift-restriction/grace-period/cancel/forget) that holds no row
  // version to pass as `payload.version`, which update() requires otherwise.
  // Callers needing a guard use `options.expect` instead.
  const tenantDb = createTenantDb({ db: conn, tenantId: SYSTEM_TENANT_ID, mode: "system" });
  const result = await userExecutor.update(
    { id: userId, changes },
    createSystemUser(SYSTEM_TENANT_ID),
    tenantDb,
    {
      skipOptimisticLock: true,
      ...(options?.expect && { expect: options.expect }),
      ...(options?.writePurpose && { writePurpose: options.writePurpose }),
      ...(options?.includeDeleted && { includeDeleted: true }),
    },
  );

  if (result.isSuccess) return { applied: true };

  if (
    options?.expect &&
    (result.error.code === "precondition_failed" || result.error.code === "version_conflict")
  ) {
    return { applied: false };
  }

  throw new InternalError({
    message: `user lifecycle update failed for ${userId}: ${result.error.code}`,
  });
}

// Reconcile existing data: rows whose lifecycle state was set by the old
// raw-updateMany path have no `user.updated` event, so a rebuild would restore
// their `user.created` defaults. This function emits one `user.updated` event per
// divergent row with its current live state, bringing the event log and live table
// back into agreement.
// MUST run once over the existing data BEFORE an app re-enables read_users
// rebuilds. State-idempotent: a second run appends an identical user.updated
// event, which is harmless because replay uses last-write-wins.
// ponytail: full read_users scan, filtered in JS—a one-time migration; no
// index/streaming is needed. For millions of rows, batch the work.
export type BackfillResult = {
  readonly backfilled: number;
  readonly failed: ReadonlyArray<{ readonly id: string; readonly error: string }>;
};

export async function backfillUserLifecycleEvents(conn: DbRunner): Promise<BackfillResult> {
  const rows = await selectMany<{
    id: string;
    status: string;
    gracePeriodEnd: unknown;
    pendingDeletionRequestId: unknown;
  }>(conn, userTable, {});

  let backfilled = 0;
  const failed: Array<{ id: string; error: string }> = [];
  for (const row of rows) {
    const divergent =
      row.status !== USER_STATUS.Active ||
      row.gracePeriodEnd != null ||
      row.pendingDeletionRequestId != null;
    if (!divergent) continue;

    // One bad row must not abort the run: the rows after it would then never
    // get their user.updated event and stay vulnerable to the rebuild wipe
    // (DSGVO-Datenverlust). Collect failures, finish the estate, report them.
    try {
      await updateUserLifecycle(conn, row.id, {
        status: row.status,
        gracePeriodEnd: row.gracePeriodEnd,
        pendingDeletionRequestId: row.pendingDeletionRequestId,
      });
      backfilled++;
    } catch (e) {
      failed.push({ id: row.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { backfilled, failed };
}
