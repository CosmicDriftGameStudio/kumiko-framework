import {
  createEntity,
  createTextField,
  type EntityDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import type { ParentRefDef } from "@cosmicdrift/kumiko-types/fields";

// folder — per-tenant hierarchical catalog, event-sourced; `parentId` null marks a root folder.
export const folderEntity = createEntity({
  name: "folder",
  table: "read_folders",
  description:
    "One folder of a tenant's hierarchical catalog: a name plus an optional parentId pointing at another folder, so the rows together form a tree whose roots have no parent.",
  fields: {
    // Catalog label, same reasoning as tags/entity.ts name: no author to
    // anchor a subject key to, not user-identifying content.
    name: createTextField({
      required: true,
      maxLength: 64,
      personal: false,
      reason: "catalog_label",
    }),
    // Parent folder id, or absent for a root folder. No FK (event-sourced); a
    // dangling parentId renders the folder at root — folders-view guards cycles.
    parentId: createTextField({ maxLength: 64, personal: false, reason: "technical_reference" }),
  },
});

// folder-assignment — host-agnostic membership row keyed by (entityType, entityId).
// Unlike tag-assignment this is SINGLE-membership: the aggregate-id is derived from
// (tenantId, entityType, entityId) WITHOUT folderId (see aggregate-id.ts), so an
// entity has exactly one assignment row and "put into folder X" updates folderId
// (move) instead of creating a second row.
//
// softDelete is required, NOT cosmetic: the aggregate-id is deterministic, so
// clearing an assignment leaves a (created+deleted) event stream under that id.
// A hard delete would force the next set to create() at version 0 onto that
// existing stream → version_conflict. With softDelete the set handler resurrects
// the stream via restore(); the list query filters isDeleted.
function buildFolderAssignmentEntity(
  access: EntityDefinition["access"] | undefined,
  parentRef: ParentRefDef | undefined,
) {
  return createEntity({
    table: "read_folder_assignments",
    description:
      "The membership row recording which folder one host entity, addressed by entityType and entityId, is filed in. At most one row exists per entity, so filing it elsewhere changes this row's folderId rather than adding a second.",
    softDelete: true,
    access,
    ...(parentRef !== undefined && { parentRef }),
    fields: {
      folderId: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      entityType: createTextField({
        required: true,
        maxLength: 64,
        personal: false,
        reason: "technical_reference",
      }),
      // Host entity ids are uuid/text; 128 covers uuid plus non-uuid text keys.
      entityId: createTextField({
        required: true,
        maxLength: 128,
        personal: false,
        reason: "technical_reference",
      }),
    },
    // A host's folder is read by (entityType, entityId); folder contents and delete-folder by folderId.
    indexes: [
      { columns: ["tenantId", "entityType", "entityId"] },
      { columns: ["tenantId", "folderId"] },
    ], name: "folder-assignment",
  });
}

export function createFolderAssignmentEntity(
  access: EntityDefinition["access"] | undefined,
  parents: readonly string[],
) {
  return buildFolderAssignmentEntity(access, {
    entityTypeField: "entityType",
    entityIdField: "entityId",
    allowedTypes: parents,
  });
}

// Table shape without the host gate; the mounted entity and its handler executors carry parentRef with the mount's parents.
export const folderAssignmentEntity = buildFolderAssignmentEntity(undefined, undefined);
