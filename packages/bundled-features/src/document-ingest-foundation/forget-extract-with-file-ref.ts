// documentExtract is derived data — once its source fileRef is gone (soft
// delete or forget), the extract has no reason to survive it. A restored
// fileRef is re-ingested by feature.ts's request-ingest MSP
// (fileRef.restored), so a fresh extract replaces the forgotten one.
//
// forget(), not deleteMany: documentExtract is an ES-managed implicit
// projection, so forget() replays correctly on rebuild. This MSP itself has
// no `table`, so rebuildMultiStreamProjection never targets it directly.

import { createTenantDb, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { MultiStreamApplyFn } from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import { NotFoundError } from "@cosmicdrift/kumiko-framework/errors";
import { documentExtractsTable } from "./entity";
import { documentExtractExecutor } from "./executor";
import { isFileRefLive } from "./file-ref-liveness";

async function forgetExtractsForFileRef(
  event: Parameters<MultiStreamApplyFn>[0],
  tenantDb: TenantDb,
): Promise<void> {
  const rows = await tenantDb.selectMany<{ id: string }>(documentExtractsTable, {
    fileRefId: event.aggregateId,
  });
  const user = createSystemUser(event.tenantId);
  for (const row of rows) {
    const result = await documentExtractExecutor.forget({ id: row.id }, user, tenantDb);
    if (result.isSuccess) continue;
    // Idempotent: a concurrent/redelivered apply that already forgot this
    // row is not an error — anything else (version conflict, ownership
    // denial) must surface so the dispatcher retries/dead-letters instead of
    // silently leaving the extract behind.
    if (result.error instanceof NotFoundError) continue;
    throw new Error(
      `document-ingest-foundation: failed to forget documentExtract ${row.id} for fileRef ${event.aggregateId}: ${result.error.message}`,
    );
  }
}

export const forgetExtractOnFileRefDeletedHook: MultiStreamApplyFn = async (event, tx) => {
  const tenantDb = createTenantDb(tx, event.tenantId);
  // skip: fileRef is live again — request-ingest and this consumer poll via
  // separate cursors, so a delete→restore round-trip can finish before this
  // consumer sees fileRef.deleted; forgetting would drop the live file's extract.
  if (await isFileRefLive(tenantDb, event.aggregateId)) return;
  await forgetExtractsForFileRef(event, tenantDb);
};

export const forgetExtractOnFileRefForgottenHook: MultiStreamApplyFn = async (event, tx) => {
  const tenantDb = createTenantDb(tx, event.tenantId);
  await forgetExtractsForFileRef(event, tenantDb);
};
