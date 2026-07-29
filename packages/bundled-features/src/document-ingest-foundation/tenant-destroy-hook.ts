// Tenant-destroy hook for the documentExtract entity-projection (#1621).
//
// Per-row forget() through the executor, not a bulk deleteMany: documentExtract
// is an ES-managed implicit projection, so a store-table write here would be
// eventless and a later rebuild would replay the historical create events and
// resurrect every row this hook removed. forget() (Art. 17 hard-purge) is
// replayed by the implicit projection itself, which keeps the erasure
// rebuild-safe — the same reasoning as tenant-lifecycle's membership stage,
// and the reason the feature owns an r.entity instead of an r.projection
// (kumiko-framework#1495). The `pages` ciphertext dies separately when the
// pipeline's later `subject-keys` stage erases the tenant subject key.

import {
  createEventStoreExecutor,
  createTenantDb,
  type DbRunner,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import { createSystemUser, type TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { documentExtractEntity, documentExtractsTable } from "./entity";

const executor = createEventStoreExecutor(documentExtractsTable, documentExtractEntity, {
  entityName: "document-extract",
});

type DestroyCtx = {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
};

export async function documentExtractTenantDestroyHook(ctx: DestroyCtx): Promise<void> {
  const rows = await selectMany<{ id: string }>(ctx.db, documentExtractsTable, {
    tenantId: ctx.tenantId,
  });
  const user = createSystemUser(ctx.tenantId);
  const db = createTenantDb(ctx.db, ctx.tenantId, "system");
  for (const row of rows) {
    const result = await executor.forget({ id: row.id }, user, db);
    // Executor writes return {isSuccess:false} instead of throwing — a
    // discarded result would report this destroy stage "succeeded" while the
    // extracted document text survives. Throw so the pipeline's retry/abandon
    // handling sees it.
    if (!result.isSuccess) {
      throw new Error(
        `document-ingest-foundation: failed to forget documentExtract ${row.id} for tenant ${ctx.tenantId}: ${result.error.message}`,
      );
    }
  }
}
