// Tenant-destroy hooks — räumen beim Tenant-Destroy alle Inbound-Mail-
// Spuren des Tenants ab. Ein Hook PRO tenant-subject-Entity (der
// gdpr-storage-Boot-Validator prüft die EXT_TENANT_DATA-Registrierung
// entity-genau), jeweils:
//
//   1. Streams archivieren — ein künftiger Projection-Rebuild kann
//      Gelöschtes nicht resurrecten (Muster billing-foundation #800).
//      Message-Streams sind viele → Loop über die Projection-Rows
//      (Row-PK = Stream-ID); tenant-destroy ist ein seltener
//      Batch-Vorgang, O(n) ist ok.
//   2. Projection-Rows löschen.
//   3. Nur mail-account: unmanaged Sync-State (Cursors, Seen-Anchors)
//      löschen — gekeyt per accountId, deshalb aus den Account-Rows
//      VOR dem Delete eingesammelt.
//
// Die eigentliche PII-Erasure macht crypto-shredding: eraseSubjectKeys
// löscht den Tenant-Subject-Key, damit werden Event-Log-Payloads UND
// etwaige Ciphertext-Kopien unlesbar. Diese Hooks entsorgen die Rows.

import {
  type DbRunner,
  deleteMany,
  type EntityTableMeta,
  selectMany,
} from "@cosmicdrift/kumiko-framework/db";
import type { TenantId } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";
import { seenMessageTable, syncCursorTable } from "./entities";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_THREAD_AGGREGATE_TYPE,
} from "./events";
import {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection";

const ARCHIVED_BY = "tenant-lifecycle:destroy";
const REASON = "tenant_destroy";

type DestroyCtx = {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
};

async function archiveAndDeleteRows(
  ctx: DestroyCtx,
  table: EntityTableMeta,
  aggregateType: string,
): Promise<readonly string[]> {
  const rows = await selectMany<{ id: string }>(ctx.db, table, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await archiveStream(ctx.db, {
      tenantId: ctx.tenantId,
      aggregateId: row.id,
      aggregateType,
      archivedBy: ARCHIVED_BY,
      reason: REASON,
    });
  }
  await deleteMany(ctx.db, table, { tenantId: ctx.tenantId });
  return rows.map((row) => row.id);
}

export async function mailAccountTenantDestroyHook(ctx: DestroyCtx): Promise<void> {
  const accountIds = await archiveAndDeleteRows(
    ctx,
    mailAccountsProjectionTable as EntityTableMeta,
    MAIL_ACCOUNT_AGGREGATE_TYPE,
  );
  for (const accountId of accountIds) {
    await deleteMany(ctx.db, syncCursorTable as EntityTableMeta, { accountId });
    await deleteMany(ctx.db, seenMessageTable as EntityTableMeta, { accountId });
  }
}

export async function inboundMessageTenantDestroyHook(ctx: DestroyCtx): Promise<void> {
  await archiveAndDeleteRows(
    ctx,
    inboundMessagesProjectionTable as EntityTableMeta,
    INBOUND_MESSAGE_AGGREGATE_TYPE,
  );
}

export async function mailThreadTenantDestroyHook(ctx: DestroyCtx): Promise<void> {
  await archiveAndDeleteRows(
    ctx,
    mailThreadsProjectionTable as EntityTableMeta,
    MAIL_THREAD_AGGREGATE_TYPE,
  );
}
