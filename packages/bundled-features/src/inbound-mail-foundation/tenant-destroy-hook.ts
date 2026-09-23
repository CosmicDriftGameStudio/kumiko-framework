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

import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
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

// archiveStream sits outside TenantDb's own methods — needs the escape hatch.
export const INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy archives each inbound-mail entity's event-streams before the projection rows are deleted";

async function archiveAndDeleteRows(
  ctx: TenantDataHookCtx,
  table: EntityTableMeta,
  aggregateType: string,
): Promise<readonly string[]> {
  const rows = await ctx.db.selectMany<{ id: string }>(table, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await archiveStream(ctx.db.unsafeRaw(INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON), {
      tenantId: ctx.tenantId,
      aggregateId: row.id,
      aggregateType,
      archivedBy: ARCHIVED_BY,
      reason: REASON,
    });
  }
  await ctx.db.deleteMany(table, { tenantId: ctx.tenantId });
  return rows.map((row) => row.id);
}

export async function mailAccountTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  const accountIds = await archiveAndDeleteRows(
    ctx,
    mailAccountsProjectionTable as EntityTableMeta,
    MAIL_ACCOUNT_AGGREGATE_TYPE,
  );
  for (const accountId of accountIds) {
    await ctx.db.deleteMany(syncCursorTable as EntityTableMeta, { accountId });
    await ctx.db.deleteMany(seenMessageTable as EntityTableMeta, { accountId });
  }
}

export async function inboundMessageTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(
    ctx,
    inboundMessagesProjectionTable as EntityTableMeta,
    INBOUND_MESSAGE_AGGREGATE_TYPE,
  );
}

export async function mailThreadTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(
    ctx,
    mailThreadsProjectionTable as EntityTableMeta,
    MAIL_THREAD_AGGREGATE_TYPE,
  );
}
