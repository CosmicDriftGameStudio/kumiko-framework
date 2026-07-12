// Tenant-destroy hook — räumt beim Tenant-Destroy alle Inbound-Mail-
// Spuren des Tenants ab:
//
//   1. Streams archivieren (mail-account / inbound-message / mail-thread)
//      — ein künftiger Projection-Rebuild kann Gelöschtes nicht
//      resurrecten (Muster billing-foundation #800). Message-Streams
//      sind viele → Loop über die Projection-Rows (Row-PK = Stream-ID);
//      tenant-destroy ist ein seltener Batch-Vorgang, O(n) ist ok.
//   2. Projection-Rows löschen.
//   3. Unmanaged Sync-State (Cursors, Seen-Anchors) löschen — gekeyt
//      per accountId, deshalb VOR dem Account-Row-Delete eingesammelt.
//
// Die eigentliche PII-Erasure macht crypto-shredding: eraseSubjectKeys
// löscht den Tenant-Subject-Key, damit werden Event-Log-Payloads UND
// etwaige Ciphertext-Kopien unlesbar. Dieser Hook entsorgt die Rows.

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

export async function inboundMailTenantDestroyHook(ctx: {
  readonly db: DbRunner;
  readonly tenantId: TenantId;
}): Promise<void> {
  const targets: ReadonlyArray<{ table: EntityTableMeta; aggregateType: string }> = [
    {
      table: mailAccountsProjectionTable as EntityTableMeta,
      aggregateType: MAIL_ACCOUNT_AGGREGATE_TYPE,
    },
    {
      table: inboundMessagesProjectionTable as EntityTableMeta,
      aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
    },
    {
      table: mailThreadsProjectionTable as EntityTableMeta,
      aggregateType: MAIL_THREAD_AGGREGATE_TYPE,
    },
  ];

  // Account-IDs VOR dem Delete einsammeln — Cursor/Seen keyen auf accountId.
  const accountRows = await selectMany<{ id: string }>(
    ctx.db,
    mailAccountsProjectionTable as EntityTableMeta,
    { tenantId: ctx.tenantId },
  );

  for (const { table, aggregateType } of targets) {
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
  }

  for (const account of accountRows) {
    await deleteMany(ctx.db, syncCursorTable as EntityTableMeta, { accountId: account.id });
    await deleteMany(ctx.db, seenMessageTable as EntityTableMeta, { accountId: account.id });
  }
}
