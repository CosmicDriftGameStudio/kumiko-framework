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
//      seen anchors, quarantine entries, ingest failure counters), which is keyed by accountId and must therefore be
//      collected from the account rows BEFORE deletion.
//
// The actual PII erasure uses crypto-shredding: eraseSubjectKeys deletes the
// tenant subject key, making event-log payloads AND any ciphertext copies
// unreadable. These hooks dispose of the rows.

import type { EntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import type { TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveAndDeleteTenantRows } from "../tenant-lifecycle/archive-and-delete-tenant-rows.ts";
import { seenMessageTable, syncCursorTable } from "./entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
  MAIL_THREAD_AGGREGATE_TYPE,
} from "./events.ts";
import { ingestFailureTable } from "./ingest-failures.ts";
import {
  inboundMessagesProjectionTable,
  mailAccountsProjectionTable,
  mailThreadsProjectionTable,
} from "./projection.ts";
import { quarantineTable } from "./quarantine-entities.ts";

// archiveStream sits outside TenantDb's own methods — needs the escape hatch.
export const INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy archives each inbound-mail entity's event-streams before the projection rows are deleted";

function archiveAndDeleteRows(
  ctx: TenantDataHookCtx,
  table: EntityTableMeta,
  aggregateType: string,
): Promise<readonly string[]> {
  return archiveAndDeleteTenantRows(
    ctx,
    table,
    aggregateType,
    INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  );
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
    await ctx.db.deleteMany(quarantineTable, { accountId });
    await ctx.db.deleteMany(ingestFailureTable, { accountId });
  }
}

export async function inboundMessageTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(ctx, inboundMessagesProjectionTable, INBOUND_MESSAGE_AGGREGATE_TYPE);
}

export async function mailThreadTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await archiveAndDeleteRows(ctx, mailThreadsProjectionTable, MAIL_THREAD_AGGREGATE_TYPE);
}
