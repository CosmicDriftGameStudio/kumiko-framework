import type {
  AccessRule,
  EntityEditScreenDefinition,
  EntityListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { DEFAULT_TAG_ACCESS, TAGS_EDIT_SCREEN_ID, TAGS_SCREEN_ID } from "./constants";

// Declarative catalog screens (Phase-3 / #2312). Access matches create/update/
// delete so createTagsFeature({ access|roles }) stays consistent. TagManager
// remains for TagPicker/TagSection — only the standalone admin screen moved.

export function createTagListScreen(
  access: AccessRule = DEFAULT_TAG_ACCESS,
): EntityListScreenDefinition {
  return {
    id: TAGS_SCREEN_ID,
    type: "entityList",
    entity: "tag",
    columns: ["name", "color", "scope"],
    defaultSort: { field: "name", dir: "asc" },
    searchable: true,
    rowActions: [
      {
        kind: "navigate",
        id: "edit",
        label: "kumiko.actions.edit",
        screen: TAGS_EDIT_SCREEN_ID,
        entityId: "id",
      },
      {
        kind: "writeHandler",
        id: "delete",
        label: "kumiko.actions.delete",
        // Convention QN — same cascade body as legacy tags:write:delete-tag.
        handler: "tags:write:tag:delete",
        payload: { pick: ["id"] },
        confirm: "kumiko.actions.delete-confirm",
        style: "danger",
      },
    ],
    access,
  };
}

export function createTagEditScreen(
  access: AccessRule = DEFAULT_TAG_ACCESS,
): EntityEditScreenDefinition {
  return {
    id: TAGS_EDIT_SCREEN_ID,
    type: "entityEdit",
    entity: "tag",
    layout: {
      sections: [
        {
          columns: 2,
          fields: [
            { field: "name", span: 2 },
            { field: "color", span: 1 },
            { field: "scope", span: 1 },
          ],
        },
      ],
    },
    access,
  };
}
