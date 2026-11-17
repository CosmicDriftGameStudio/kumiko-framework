import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createJsonbField,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

export const OUTBOUND_SEND_STATUSES = ["sending", "sent"] as const;
export type OutboundSendStatus = (typeof OUTBOUND_SEND_STATUSES)[number];

/** One row per keyed send from a mailbox, so a retry with the same key does not send a second copy.
 *  No recipients and no subject: the row holds ids and the Message-ID only, nothing personal. */
export const outboundMailSendEntity = createEntity({
  name: "mail-outbound-send",
  table: "store_mail_outbound_sends",
  softDelete: false,
  indexes: [{ unique: true, columns: ["tenantId", "userId", "accountId", "idempotencyKey"] }],
  fields: {
    idempotencyKey: createTextField({
      required: true,
      maxLength: 200,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    // Rows from before the user binding have no userId and never match a lookup.
    userId: createTextField({
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    // "sending" is the claim written before the send; "sent" is set after the server accepted the mail.
    status: createTextField({
      required: true,
      maxLength: 10,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    messageIdHeader: createTextField({
      maxLength: 500,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    attachmentFileIds: createJsonbField({
      emptyValue: "array",
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    claimedAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
    sentAt: createTimestampField({
      access: { write: access.privileged },
    }),
  },
});

export const outboundMailSendsTable = deriveEntityTableMeta(outboundMailSendEntity, {
  source: "unmanaged",
});
