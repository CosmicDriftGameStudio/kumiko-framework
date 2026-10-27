// inbound-message:detail — the record the file read guard asks for when someone opens a mail
// attachment (createRecordReadCheck runs "<entity>:detail" as the caller). It answers with
// visibility only: no PII column is selected, so opening a file never reaches the KMS.

import type { QueryHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import * as z from "zod";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { isVisibleToCaller } from "./scope-visibility.ts";

const messageDetailSchema = z.object({ id: z.uuid() }).strict();

const DETAIL_COLUMNS = ["id", "tenantId", "accountId", "ownerUserId", "scope", "receivedAt"];

export function createMessageDetailQuery({ memberRoles }: InboundMailRoles): QueryHandlerDef {
  return {
    name: `${INBOUND_MESSAGE_AGGREGATE_TYPE}:detail`,
    schema: messageDetailSchema,
    access: { roles: [...memberRoles] },
    agent: { expose: false },
    description:
      "Returns the non-personal envelope fields of one received mail, or null when it does not exist or belongs to a personal mailbox the caller does not own; the file read guard uses it to decide who may open the mail's attachments.",
    handler: async (query, ctx) => {
      const { id } = messageDetailSchema.parse(query.payload);
      const [row] = await ctx.db.selectMany(
        inboundMessagesProjectionTable,
        { id, tenantId: ctx.user.tenantId },
        { fields: DETAIL_COLUMNS },
      );
      return row && isVisibleToCaller(row, ctx.user) ? row : null;
    },
  };
}
