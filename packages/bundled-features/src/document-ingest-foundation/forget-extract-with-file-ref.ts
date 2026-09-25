// documentExtract is derived data — once its source fileRef is gone (soft
// delete or forget), the extract has no reason to survive it. A restored
// fileRef is re-ingested by feature.ts's request-ingest MSP
// (fileRef.restored), so a fresh extract replaces the forgotten one.
//
// forget(), not deleteMany: documentExtract is an ES-managed implicit
// projection, so forget() replays correctly on rebuild. This MSP itself has
// no `table`, so rebuildMultiStreamProjection never targets it directly.
//
// Also reacts to documentExtract.created: providers write extracts
// themselves (own executor call), racing this consumer's fileRef.deleted/
// forgotten handling. Each handler re-checks current fileRef liveness at
// processing time, so no extract survives regardless of write/delete order —
// this covers providers that bypass write-document-extract.ts's helper too.

import { createTenantDb, type TenantDb } from "@cosmicdrift/kumiko-framework/db";
import type { MultiStreamApplyFn } from "@cosmicdrift/kumiko-framework/engine";
import { createSystemUser } from "@cosmicdrift/kumiko-framework/engine";
import type { WriteErrorInfo } from "@cosmicdrift/kumiko-framework/errors";
import * as z from "zod";
import { documentExtractsTable } from "./entity";
import { documentExtractExecutor } from "./executor";
import { isFileRefLive } from "./file-ref-liveness";

// WriteResult.error is always a plain WriteErrorInfo object, never a
// KumikoError instance (JSON-serializable for the dispatcher's idempotency-key
// storage) — compare on .code, not instanceof.
function isNotFoundWriteError(error: WriteErrorInfo): boolean {
  return error.code === "not_found";
}

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
    if (isNotFoundWriteError(result.error)) continue;
    throw new Error(
      `document-ingest-foundation: failed to forget documentExtract ${row.id} for fileRef ${event.aggregateId}: ${result.error.message}`,
    );
  }
}

const documentExtractCreatedPayloadSchema = z.object({ fileRefId: z.string().min(1) });

export const forgetOrphanedDocumentExtractHook: MultiStreamApplyFn = async (event, tx) => {
  const parsed = documentExtractCreatedPayloadSchema.safeParse(event.payload);
  // skip: malformed payload — don't poison the consumer
  if (!parsed.success) return;
  const tenantDb = createTenantDb(tx, event.tenantId);
  // skip: fileRef still live — the extract is legitimate
  if (await isFileRefLive(tenantDb, parsed.data.fileRefId)) return;
  const user = createSystemUser(event.tenantId);
  const result = await documentExtractExecutor.forget({ id: event.aggregateId }, user, tenantDb);
  // skip: forgotten now, or already gone via a concurrent/redelivered apply
  if (result.isSuccess || isNotFoundWriteError(result.error)) return;
  throw new Error(
    `document-ingest-foundation: failed to forget orphaned documentExtract ${event.aggregateId}: ${result.error.message}`,
  );
};

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
