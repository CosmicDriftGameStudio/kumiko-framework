// Tenant-destroy hooks remove all inbound-mail traces belonging to the tenant.
// One hook per tenant-subject entity (the gdpr-storage boot validator checks
// the EXT_TENANT_DATA registration per entity), each of which:
//
//   1. Archives streams so a future projection rebuild cannot resurrect
//      deleted data. Message streams are numerous, so loop over the
//      projection rows (row PK = stream ID); tenant-destroy is a rare batch
//      operation, so O(n) is acceptable.
//   2. Deletes the projection rows.
//   3. For mail-account only, deletes unmanaged sync state (cursors,
//      seen anchors), which is keyed by accountId and must therefore be
//      collected from the account rows BEFORE deletion.
//
// The actual PII erasure uses crypto-shredding: eraseSubjectKeys deletes the
// tenant subject key, making event-log payloads AND any ciphertext copies
// unreadable. These hooks dispose of the rows.

import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import { declareEscapeHatch, type TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveStream } from "@cosmicdrift/kumiko-framework/event-store";
import { seenMessageTable, syncCursorTable } from "./entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_THREAD_AGGREGATE_TYPE,
} from "./events.ts";
import {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.ts";

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
  declareEscapeHatch({ reason: INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON });
  const rows = await ctx.db.selectMany<{ id: string }>(table, { tenantId: ctx.tenantId });
  for (const row of rows) {
    await archiveStream(ctx.db.unsafeRaw(), {
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
    mailAccountsProjectionTable,
    MAIL_ACCOUNT_AGGREGATE_TYPE,
  );
  for (const accountId of accountIds) {
    await ctx.db.deleteMany(syncCursorTable, { accountId });
    await ctx.db.deleteMany(seenMessageTable, { accountId });
  }
}

export async function inboundMessageTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(ctx, inboundMessagesProjectionTable, INBOUND_MESSAGE_AGGREGATE_TYPE);
}

export async function mailThreadTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(ctx, mailThreadsProjectionTable, MAIL_THREAD_AGGREGATE_TYPE);
}
