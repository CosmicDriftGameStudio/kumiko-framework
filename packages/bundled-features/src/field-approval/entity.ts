import {
  createEntity,
  createLongTextField,
  createSelectField,
  createTextField,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ParentRefDef } from "@cosmicdrift/kumiko-types/fields";
import { FieldChangeStatus } from "./constants.ts";

const STATUS_OPTIONS = [
  FieldChangeStatus.Pending,
  FieldChangeStatus.Approved,
  FieldChangeStatus.Rejected,
] as const;

// field-change-request — event-sourced, host-agnostic request row keyed by
// (entityType, entityId, fieldName). The requester is `modifiedById`, or `insertedById` while the row was only created (requesterIdOf): every
// request writes the row and every decision moves the status off pending, so
// the last writer of a pending row is the one who filed it.
function buildFieldChangeRequestEntity(parentRef: ParentRefDef | undefined) {
  return createEntity({
    table: "read_field_change_requests",
    description:
      "One requested change of an approval-gated field on a host record, held as pending until a second person with an approve role applies or rejects it.",
    ...(parentRef !== undefined && { parentRef }),
    fields: {
      entityType: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      entityId: createTextField({
        required: true,
        maxLength: 128,
        personal: false,
        reason: "technical_reference",
      }),
      fieldName: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      status: createSelectField({ options: STATUS_OPTIONS, required: true }),
      // JSON.stringify of the new field value. For a PII-encrypted host field this is already
      // its ciphertext under the host record's subject, so forgetting the host makes it
      // unreadable; a PII annotation here would encrypt it a second time. Nulled after the decision.
      requestedValue: createLongTextField({
        personal: false,
        reason: "pii_ciphertext_under_host_subject",
      }),
    },
    indexes: [
      { columns: ["tenantId", "status"] },
      { columns: ["tenantId", "entityType", "entityId"] },
    ],
    name: "field-change-request",
  });
}

export function createFieldChangeRequestEntity(parents: readonly string[]) {
  return buildFieldChangeRequestEntity({
    entityTypeField: "entityType",
    entityIdField: "entityId",
    allowedTypes: parents,
  });
}

// Table shape without the host gate; the mounted entity and its handler executors carry parentRef with the mount's parents.
export const fieldChangeRequestEntity = buildFieldChangeRequestEntity(undefined);
