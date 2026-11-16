import {
  type AccessRule,
  type EntityEditScreenDefinition,
  type EntityListScreenDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import {
  DEFAULT_TAG_ACCESS,
  TAGS_EDIT_SCREEN_ID,
  TAGS_SCREEN_ID,
  TagsHandlers,
} from "./web/constants.ts";

// Declarative catalog screens. Access matches the catalog write handlers so
// createTagsFeature({ access|roles }) stays consistent.

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
        label: i18nKey("kumiko.actions.edit"),
        screen: TAGS_EDIT_SCREEN_ID,
        entityId: "id",
      },
      {
        kind: "writeHandler",
        id: "delete",
        label: i18nKey("kumiko.actions.delete"),
        handler: TagsHandlers.deleteTag,
        payload: { pick: ["id"] },
        confirm: i18nKey("kumiko.actions.delete-confirm"),
        style: "danger",
      },
    ],
    access,
    // App navs via r.nav("tags:screen:tag-list") — no nav area to resolve
    // in isolation.
    dormant: true,
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
