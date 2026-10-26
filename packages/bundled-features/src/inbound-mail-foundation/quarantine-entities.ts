import { deriveEntityTableMeta } from "@cosmicdrift/kumiko-framework/db";
import {
  access,
  createEntity,
  createTextField,
  createTimestampField,
} from "@cosmicdrift/kumiko-framework/engine";

export const QUARANTINE_REASON_CODES = ["unparseable", "invalid_message", "ingest_failed"] as const;
export type QuarantineReasonCode = (typeof QUARANTINE_REASON_CODES)[number];

/** A provider message the ingest cannot take. No subject or sender, so nothing here is personal data;
 *  the UID is enough for the operator to find the mail in the mailbox. */
export const quarantineEntity = createEntity({
  table: "store_mail_quarantine",
  softDelete: false,
  indexes: [{ unique: true, columns: ["tenantId", "accountId", "providerMessageId"] }],
  fields: {
    accountId: createTextField({
      required: true,
      maxLength: 36,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    providerMessageId: createTextField({
      required: true,
      maxLength: 500,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    reasonCode: createTextField({
      required: true,
      maxLength: 30,
      access: { write: access.privileged },
      personal: false,
      reason: "technical_reference",
    }),
    quarantinedAt: createTimestampField({
      required: true,
      access: { write: access.privileged },
    }),
    acknowledgedAt: createTimestampField({
      access: { write: access.privileged },
    }),
    // Set by retry-quarantined-message; the next successful sync of the mailbox reloads the mail and clears the row.
    retryRequestedAt: createTimestampField({
      access: { write: access.privileged },
    }),
  },
});

export const quarantineTable = deriveEntityTableMeta("mail-quarantine", quarantineEntity, {
  source: "unmanaged",
});
