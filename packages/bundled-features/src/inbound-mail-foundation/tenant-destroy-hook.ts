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
//      collected from the account rows BEFORE deletion. Outbound send records go by tenant.
//
// The tenant key shreds the mailbox address. This hook shreds the content of
// the mails through their record keys.

import { selectMany } from "@cosmicdrift/kumiko-framework/db";
import type { TenantDataHookCtx } from "@cosmicdrift/kumiko-framework/engine";
import { eventsTable } from "@cosmicdrift/kumiko-framework/event-store";
import { archiveAndDeleteTenantRows } from "../tenant-lifecycle/index.ts";
import { seenMessageTable, syncCursorTable } from "./entities.ts";
import { INBOUND_MESSAGE_AGGREGATE_TYPE, MAIL_ACCOUNT_AGGREGATE_TYPE } from "./events.ts";
import { ingestFailureTable } from "./ingest-failures.ts";
import { outboundMailSendsTable } from "./outbound-send-entities.ts";
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
  await ctx.db.deleteMany(outboundMailSendsTable, { tenantId: ctx.tenantId });
}

const MESSAGE_TENANT_DESTROY_ERASE_REASON = "inbound-mail-foundation:tenant-destroy";

const MESSAGE_EVENT_PAGE_SIZE = 500;

type MessageEventRow = { readonly id: bigint; readonly aggregateId: string };

// The event log, not the projection: the retention sweep deletes rows of expired mails and by
// default keeps their keys, and the subject-keys stage erases only tenant and user keys.
async function eraseAllInboundMessageKeysOfTenant(ctx: TenantDataHookCtx): Promise<void> {
  const erasedMessageIds = new Set<string>();
  let cursor: bigint | undefined;
  for (;;) {
    const page = await selectMany<MessageEventRow>(
      ctx.db,
      eventsTable,
      {
        // Explicit: tenant-mode reads also return SYSTEM_TENANT_ID rows, whose keys are not this tenant's.
        tenantId: ctx.tenantId,
        aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
        ...(cursor !== undefined && { id: { gt: cursor } }),
      },
      {
        fields: ["id", "aggregateId"],
        orderBy: { col: "id", direction: "asc" },
        limit: MESSAGE_EVENT_PAGE_SIZE,
      },
    );
    for (const row of page) {
      if (erasedMessageIds.has(row.aggregateId)) continue;
      erasedMessageIds.add(row.aggregateId);
      await eraseInboundMessageKey(row.aggregateId, MESSAGE_TENANT_DESTROY_ERASE_REASON);
    }
    const lastRow = page.at(-1);
    if (lastRow === undefined || page.length < MESSAGE_EVENT_PAGE_SIZE) return;
    cursor = lastRow.id;
  }
}

export async function inboundMessageTenantDestroyHook(ctx: TenantDataHookCtx): Promise<void> {
  await eraseAllInboundMessageKeysOfTenant(ctx);
  await archiveAndDeleteTenantRows(
    ctx,
    inboundMessagesProjectionTable,
    INBOUND_MESSAGE_AGGREGATE_TYPE,
    INBOUND_MAIL_TENANT_DESTROY_ARCHIVE_REASON,
  );
}
