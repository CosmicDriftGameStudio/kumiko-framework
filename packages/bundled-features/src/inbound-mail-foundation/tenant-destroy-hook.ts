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
// The tenant key shreds the mailbox address. This hook shreds the content of
// the mails through their record keys.

import type { TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { archiveAndDeleteTenantRows } from "../tenant-lifecycle/index.ts";
import { seenMessageTable, syncCursorTable } from "./entities.ts";
import {
  INBOUND_MESSAGE_AGGREGATE_TYPE,
  MAIL_ACCOUNT_AGGREGATE_TYPE,
} from "./events.ts";
import { ingestFailureTable } from "./ingest-failures.ts";
import { inboundMessagesProjectionTable, mailAccountsProjectionTable } from "./projection.ts";
import { eraseInboundMessageKey } from "./purge-messages.ts";
import { quarantineTable } from "./quarantine-entities.ts";

// archiveStream sits outside TenantDb's own methods — needs the escape hatch.
export const INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON =
  "tenant-destroy archives each inbound-mail entity's event-streams before the projection rows are deleted";

export async function mailAccountTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  const accountIds = await archiveAndDeleteTenantRows(
    ctx,
    mailAccountsProjectionTable,
    MAIL_ACCOUNT_AGGREGATE_TYPE,
    INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  );
  for (const accountId of accountIds) {
    await ctx.db.deleteMany(syncCursorTable, { accountId });
    await ctx.db.deleteMany(seenMessageTable, { accountId });
    await ctx.db.deleteMany(quarantineTable, { accountId });
    await ctx.db.deleteMany(ingestFailureTable, { accountId });
  }
}

const MESSAGE_TENANT_DESTROY_ERASE_REASON = "inbound-mail-foundation:tenant-destroy";

export async function inboundMessageTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  // Before the rows go: they are the only pointer to the message ids, and the subject-keys stage
  // erases only tenant and user keys.
  const rows = await ctx.db.selectMany<{ id: string }>(inboundMessagesProjectionTable, {
    tenantId: ctx.tenantId,
  });
  for (const row of rows) await eraseInboundMessageKey(row.id, MESSAGE_TENANT_DESTROY_ERASE_REASON);
  await archiveAndDeleteTenantRows(
    ctx,
    inboundMessagesProjectionTable,
    INBOUND_MESSAGE_AGGREGATE_TYPE,
    INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  );
}
