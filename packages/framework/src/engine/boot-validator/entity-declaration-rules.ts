import type { BootRuleTable } from "./boot-rule.ts";

export const ENTITY_DECLARATION_RULES = {
  parentRefTypeFieldUnknown: {
    id: "parent-ref/entity-type-field-unknown",
    summary: "parentRef.entityTypeField names a declared field of the entity.",
    fix: "Point entityTypeField at a real field on the entity.",
  },
  parentRefIdFieldUnknown: {
    id: "parent-ref/entity-id-field-unknown",
    summary: "parentRef.entityIdField names a declared field of the entity.",
    fix: "Point entityIdField at a real field on the entity.",
  },
  parentRefAllowedTypesEmpty: {
    id: "parent-ref/allowed-types-empty",
    summary: "parentRef.allowedTypes names at least one host entity.",
    fix: "List at least one registered host entity in allowedTypes.",
  },
  parentRefAllowedTypeUnregistered: {
    id: "parent-ref/allowed-type-unregistered",
    summary: "parentRef.allowedTypes names only registered entities.",
    fix: "Remove the name from allowedTypes, or register the entity.",
  },
  parentRefAllowedTypeHasParentRef: {
    id: "parent-ref/allowed-type-has-parent-ref",
    summary: "A parentRef host entity does not itself declare a parentRef (no recursive gating).",
    fix: "Remove the host from allowedTypes, or drop its own parentRef.",
  },
  parentRefHandWrittenQuery: {
    id: "parent-ref/hand-written-query-handler",
    summary:
      "Query handlers on an entity with parentRef carry the entity-convention brand, so the parent-ref read-gate applies.",
    fix: "Register the handler via defineEntityListHandler/defineEntityDetailHandler, or pass parentVisibility to the executor.",
  },
  parentRefHandWrittenWrite: {
    id: "parent-ref/hand-written-write-handler",
    summary:
      "Update/delete/restore handlers on an entity with parentRef carry the entity-convention brand, so the parent visibility gate applies.",
    fix: "Register the handler via defineEntityUpdateHandler, defineEntityDeleteHandler or defineEntityRestoreHandler, or pass parentVisibility: parentVisibilityFor(ctx, event.user) to the executor.",
  },
  readGateWithParentRef: {
    id: "read-gate/with-parent-ref",
    summary: "An entity with readGate does not also declare parentRef.",
    fix: "Drop readGate or parentRef.",
  },
  readGateAnyAndAllLinks: {
    id: "read-gate/any-and-all-links",
    summary: "A readGate declares anyLink or allLinks, not both.",
    fix: "Pick one of anyLink and allLinks.",
  },
  readGateLinkEntityUnregistered: {
    id: "read-gate/link-entity-unregistered",
    summary: "A readGate link names a registered entity.",
    fix: "Register the entity or fix the readGate link entity name.",
  },
  readGateLinkWithoutParentRef: {
    id: "read-gate/link-entity-without-parent-ref",
    summary:
      "A readGate link entity declares a parentRef, because its host visibility is what the gate checks.",
    fix: "Declare a parentRef on the link entity or use another entity.",
  },
  readGateLinkFieldUnknown: {
    id: "read-gate/link-field-unknown",
    summary: "A readGate link field is a field of the link entity.",
    fix: "Point the link field at a real field of the link entity.",
  },
  readGateFileOwnerFieldType: {
    id: "read-gate/file-owner-field-type",
    summary: "readGate.fileOwner.field is a single file or image field.",
    fix: "Point fileOwner.field at a single file or image field.",
  },
  fieldApproveRolesEmpty: {
    id: "field-approval/approve-roles-empty",
    summary: "access.approve lists at least one role.",
    fix: "List the approver roles or drop approve.",
  },
  fieldApproveOutsideWrite: {
    id: "field-approval/approve-outside-write",
    summary: "Every approve role may write the field.",
    fix: "Add the role to access.write or drop it from approve.",
  },
  fieldApproveFieldType: {
    id: "field-approval/field-type",
    summary:
      "access.approve is set on a scalar field (text, longText, number, bigInt, decimal, select, boolean, date, reference).",
    fix: "Move approve to a scalar field.",
  },
  fieldApproveEmbedded: {
    id: "field-approval/embedded-sub-field",
    summary: "access.approve is set on top-level fields only.",
    fix: "Move approve to a top-level field.",
  },
  fieldApproveNeedsWrite: {
    id: "field-approval/needs-write",
    summary: "A field with access.approve declares access.write.",
    fix: "List the roles that may change the field in access.write, including the approve roles.",
  },
  fieldApproveUnsealedSecret: {
    id: "field-approval/secret-field",
    summary:
      "access.approve is not set on an encrypted or writeOnly field that is not encrypted under a data subject.",
    fix: "Annotate the field with a personal subject so the pending value is sealed, or drop approve.",
  },
  fieldApproveNeedsFeature: {
    id: "field-approval/needs-feature",
    summary:
      "A field with access.approve needs the field-approval feature mounted with its entity among the parents.",
    fix: "Mount createFieldApprovalFeature({ parents: [...] }) and list the entity.",
  },
  readGateFileOwnerNeedsFiles: {
    id: "read-gate/file-owner-needs-files-feature",
    summary: "readGate.fileOwner requires the files feature to be mounted.",
    fix: "Mount the files feature.",
  },
  readGateHandWrittenReader: {
    id: "read-gate/hand-written-reader",
    summary:
      "A gated entity's list and detail query handlers are entity-convention handlers, so they cannot bypass the readGate.",
    fix: "Register them via defineEntityListHandler/defineEntityDetailHandler.",
  },
  transferMultipleReference: {
    id: "transfer/multiple-reference-field",
    summary:
      "A transferable entity declares no multiple reference field to another transferable entity, since the transfer graph cannot match jsonb array rows.",
    fix: "Model the link as a single reference on the owning side, or drop transferable from the entity.",
  },
  transferGraphTooDeep: {
    id: "transfer/graph-too-deep",
    summary: "The tenant-handover transfer graph is not deeper than the maximum depth.",
    fix: 'Flatten the chain, or mark a reference field that should not move with its host `handover: "stay"`.',
  },
  transferCustomProjection: {
    id: "transfer/custom-projection",
    summary:
      "An r.projection fed by a transferable entity writes into that entity's own table, since tenant-handover moves only the entity table rows.",
    fix: "Move the projected columns into the entity, or drop transferable from the source entity.",
  },
  transferMultiStreamProjection: {
    id: "transfer/multi-stream-projection",
    summary:
      "A multi-stream projection with a table applies no events of a transferable entity, since tenant-handover moves only the entity table rows.",
    fix: "Move the projected columns into the entity, drop the projection's table (side effects only), or drop transferable from the source entity.",
  },
  globalWithoutSystemStream: {
    id: "entity/global-without-system-stream",
    summary: 'An entity with tenancy "global" also declares systemStream: true.',
    fix: "Declare systemStream: true on the entity.",
  },
  globalWithoutSystemScope: {
    id: "entity/global-without-system-scope",
    summary: 'A feature that owns an entity with tenancy "global" declares r.systemScope().',
    fix: "Declare r.systemScope() in the owning feature.",
  },
  recordOwnedSerialId: {
    id: "pii/record-owned-serial-id",
    summary:
      'A recordOwned (or whenAbsent: "self") field lives only on entities with idType "uuid", because forgetSubject validates the record id as a UUID.',
    fix: 'Set idType: "uuid" on the entity, or give the field a different personal stance.',
  },
  forgetWithSubjectWithoutSubjectField: {
    id: "pii/forget-with-subject-without-subject-field",
    summary:
      'An entity with forgetWithSubject: true has a personal: "self" or record-keyed field, so a forget can name its row as a subject.',
    fix: 'Give the entity a personal: "self" or personal: { of: "id" } field, or remove forgetWithSubject.',
  },
  forgetWithSubjectBlockDelete: {
    id: "pii/forget-with-subject-block-delete",
    summary:
      'An entity with forgetWithSubject: true does not declare retention.strategy "blockDelete".',
    fix: "Remove forgetWithSubject, or choose a retention strategy that allows deleting the row.",
  },
  recordKeyOneOwner: {
    id: "pii/record-key-one-owner",
    summary:
      'An entity with whenAbsent: "self" fields names one owner field for all of them and has no recordOwned field, because forgetting that owner erases the record key.',
    fix: 'Give the owner-keyed fields whenAbsent: "tenant", use one owner field, or keep the record\'s own data on a separate entity.',
  },
  crossTenantFileReadQueryUnregistered: {
    id: "files/cross-tenant-read-query-unregistered",
    summary: "crossTenantFileRead.query names a registered query handler.",
    fix: "Use the qualified name of a query handler (<feature>:query:<name>) and register it.",
  },
  crossTenantFileReadReasonMissing: {
    id: "files/cross-tenant-read-reason-missing",
    summary: "crossTenantFileRead declares a non-empty reason.",
    fix: "State why files of this entity are readable across tenants.",
  },
  crossTenantFileReadRestrictedField: {
    id: "files/cross-tenant-read-restricted-file-field",
    summary:
      "An entity with crossTenantFileRead has no file field or embedded file sub-field with an access.read rule, because the cross-tenant check asks only whether the declared query returns the record.",
    fix: "Drop the field's access.read, or move the restricted file into an entity without crossTenantFileRead.",
  },
  streamRetentionKeepFor: {
    id: "retention/stream-retention-keep-for",
    summary: "streamRetention.keepFor has the form <number><h|d|w|m|y>.",
    fix: 'Write keepFor like "30d", "12w" or "1y".',
  },
  streamRetentionWithRowRetention: {
    id: "retention/stream-retention-with-row-retention",
    summary: "An entity declares retention or streamRetention, not both.",
    fix: "Keep retention for rows with a legal or business keep period; use streamRetention only for technical state without one.",
  },
  streamRetentionStreamShape: {
    id: "retention/stream-retention-stream-shape",
    summary:
      'An entity with streamRetention has per-tenant streams and uuid ids (no systemStream, no idType "serial").',
    fix: 'Remove streamRetention, or drop systemStream and idType "serial" from the entity.',
  },
  streamRetentionFileField: {
    id: "retention/stream-retention-file-field",
    summary: "An entity with streamRetention has no file or image fields.",
    fix: 'Use retention with strategy "hardDelete", which deletes the file bytes with the row, or move the file to another entity.',
  },
  streamRetentionForeignReader: {
    id: "retention/stream-retention-foreign-reader",
    summary:
      "No table-bearing r.projection or r.multiStreamProjection reads the events of an entity with streamRetention.",
    fix: "Remove streamRetention, or build the other read model without this entity's events.",
  },
} as const satisfies BootRuleTable;
