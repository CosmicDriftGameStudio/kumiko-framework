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
import { INBOUND_MESSAGE_PII_FIELDS, inboundMessageEntity } from "../entities.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

// The full text is delivered only by message:content; selecting it here would also decrypt it.
const LIST_MESSAGE_COLUMNS = [
  "id",
  "tenantId",
  "version",
  "insertedAt",
  "modifiedAt",
  "insertedById",
  "modifiedById",
  ...Object.keys(inboundMessageEntity.fields).filter((name) => name !== "bodyText"),
];

const listMessagesSchema = z
  .object({
    accountId: z.uuid().optional(),
    threadKey: z.string().min(1).max(500).optional(),
    scope: z.string().min(1).max(200).optional(),
  })
  .strict();
type ListMessagesPayload = z.infer<typeof listMessagesSchema>;

export function createListMessagesQuery({ memberRoles }: InboundMailRoles): QueryHandlerDef {
  return {
    name: "message:list",
    schema: listMessagesSchema,
    access: { roles: [...memberRoles] },
    description:
      "Lists received mail of the caller's tenant with sender, recipients, subject and snippet decrypted, optionally narrowed to one account, thread or folder scope and hiding messages of personal mailboxes the caller does not own; use it to read an inbox or a conversation.",
    handler: async (query, ctx) => {
      // @cast-boundary engine-payload — dispatcher-zod-validated payload
      const payload = query.payload as ListMessagesPayload;
      const filter: Record<string, unknown> = { tenantId: ctx.user.tenantId };
      if (payload.accountId) filter["accountId"] = payload.accountId;
      if (payload.threadKey) filter["threadKey"] = payload.threadKey;
      if (payload.scope) filter["scope"] = payload.scope;

      const allRows = await ctx.db.selectMany(inboundMessagesProjectionTable, filter, {
        fields: LIST_MESSAGE_COLUMNS,
      });
      // Scope visibility: messages in personal mailboxes are visible only to the owner.
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
}
