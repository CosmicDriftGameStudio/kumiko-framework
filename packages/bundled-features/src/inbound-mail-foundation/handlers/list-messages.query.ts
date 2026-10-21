// list-messages — tenant-scoped message list for the inbox cockpit.
// Optional filters: accountId (one mailbox), threadKey (one conversation),
// scope (folder hint). PII (from/to/cc/subject/snippet) is decrypted on read;
// to/cc remain JSON-stringified strings, which the client parses as documented
// in the event payload.
//
// Deliberately no pagination in V1: the projection is tenant-scoped and the
// inbox cockpit loads bounded time ranges; a `limit` field can be added
// compatibly without breaking the QN.

import {
  configuredPiiSubjectKms,
  decryptPiiFieldValues,
} from "@cosmicdrift/kumiko-framework/crypto";
import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { INBOUND_MESSAGE_PII_FIELDS } from "../entities.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

const listMessagesSchema = z
  .object({
    accountId: z.uuid().optional(),
    threadKey: z.string().min(1).max(500).optional(),
    scope: z.string().min(1).max(200).optional(),
  })
  .strict();
type ListMessagesPayload = z.infer<typeof listMessagesSchema>;

export const listMessagesQuery: QueryHandlerDef = {
  name: "message:list",
  schema: listMessagesSchema,
  access: { roles: ["SystemAdmin", "TenantAdmin", "User"] },
  description:
    "Lists received mail of the caller's tenant with sender, recipients, subject and snippet decrypted, optionally narrowed to one account, thread or folder scope and hiding messages of personal mailboxes the caller neither owns nor administers; use it to read an inbox or a conversation.",
  handler: async (query, ctx) => {
    // @cast-boundary engine-payload — dispatcher-zod-validated payload
    const payload = query.payload as ListMessagesPayload;
    const filter: Record<string, unknown> = { tenantId: ctx.user.tenantId };
    if (payload.accountId) filter["accountId"] = payload.accountId;
    if (payload.threadKey) filter["threadKey"] = payload.threadKey;
    if (payload.scope) filter["scope"] = payload.scope;

    const allRows = await ctx.db.selectMany(inboundMessagesProjectionTable, filter);
    // Scope visibility: messages in personal mailboxes are visible only to the
    // owner or TenantAdmin/SystemAdmin.
    const rows = allRows.filter((row) => isVisibleToCaller(row, ctx.user));
    const piiKms = configuredPiiSubjectKms();
    if (!piiKms) return { rows };
    const decryptedRows = await Promise.all(
      rows.map((row) =>
        decryptPiiFieldValues(row, INBOUND_MESSAGE_PII_FIELDS, piiKms, {
          requestId: `inbound-mail-foundation:list-messages:${ctx.user.tenantId}`,
        }),
      ),
    );
    return { rows: decryptedRows };
  },
};
