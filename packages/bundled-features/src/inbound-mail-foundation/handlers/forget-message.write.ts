import type { WriteHandlerDef } from "@cosmicdrift/kumiko-framework/engine";
import {
  AccessDeniedError,
  failNotFound,
  writeFailure,
} from "@cosmicdrift/kumiko-framework/errors";
import { deleteFileRefsBoundToRecord } from "@cosmicdrift/kumiko-framework/files";
import * as z from "zod";
import { INBOUND_MESSAGE_AGGREGATE_TYPE } from "../events.ts";
import type { InboundMailRoles } from "../mail-roles.ts";
import { inboundMessagesProjectionTable } from "../projection.ts";
import { purgeInboundMessages } from "../purge-messages.ts";
import { isVisibleToCaller, mayReactivateMailbox } from "./scope-visibility.ts";

export const forgetMessageSchema = z.object({ messageId: z.uuid() });

const FORGET_REASON = "forgotten_by_user";

export function createForgetMessageHandler({
  memberRoles,
  adminRoles,
}: InboundMailRoles): WriteHandlerDef {
  return {
    name: "forget-message",
    schema: forgetMessageSchema,
    access: { roles: [...memberRoles] },
    agent: { risk: "high" },
    description:
      "Permanently removes one imported mail: the read row, the stored original and its attachment files; the mail cannot be restored and a later sync does not import it again. The owner of a personal mailbox or, for a shared one, an admin may call it; a mail of someone else's personal mailbox is reported as not found.",
    handler: async (event, ctx) => {
      const { messageId } = forgetMessageSchema.parse(event.payload);
      const [row] = await ctx.db.selectMany<{
        readonly id: string;
        readonly bodyRef: string | null;
        readonly ownerUserId: string | null;
      }>(inboundMessagesProjectionTable, { id: messageId });
      if (!row || !isVisibleToCaller(row, event.user)) {
        return failNotFound("inbound-message", messageId);
      }
      if (!mayReactivateMailbox(row.ownerUserId, event.user, adminRoles)) {
        return writeFailure(new AccessDeniedError({ details: { reason: "not_mailbox_owner" } }));
      }

      const { files } = ctx.services;
      // Without file storage the original could not be deleted, and the row held its only reference.
      if (row.bodyRef && !files) {
        throw new Error(
          `forget-message: no file storage to delete the stored original of ${messageId}`,
        );
      }
      const purged = await purgeInboundMessages({
        db: ctx.db,
        tenantId: event.user.tenantId,
        rows: [row],
        archive: (id) =>
          ctx.events.archive(id, {
            aggregateType: INBOUND_MESSAGE_AGGREGATE_TYPE,
            reason: FORGET_REASON,
          }),
        deleteBodyObject: files
          ? (bodyRef) => files.refFromFileRef({ storageKey: bodyRef }).delete()
          : undefined,
        deleteAttachments: async (id) => {
          await deleteFileRefsBoundToRecord({
            db: ctx.db,
            user: event.user,
            entityType: INBOUND_MESSAGE_AGGREGATE_TYPE,
            entityId: id,
          });
        },
      });
      // Rolls the archive back: a half-deleted mail must stay retryable.
      if (purged.failedIds.length > 0) {
        throw new Error(`forget-message: the stored files of ${messageId} could not be deleted`);
      }
      return { isSuccess: true as const, data: { forgotten: true as const } };
    },
  };
}
