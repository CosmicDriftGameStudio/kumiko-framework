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
} as const satisfies BootRuleTable;
