import {
  type AccessRule,
  type EntityListScreenDefinition,
  i18nKey,
} from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENTS_LIST_SCREEN_ID } from "./constants.ts";

// The columns every document list shows; the tab and the standalone screen stay alike.
export const DOCUMENT_COLUMNS = ["title", "category", "validUntil", "file"] as const;

export function createDocumentListScreen(access: AccessRule): EntityListScreenDefinition {
  return {
    id: DOCUMENTS_LIST_SCREEN_ID,
    type: "entityList",
    entity: "document",
    columns: [...DOCUMENT_COLUMNS],
    defaultSort: { field: "validUntil", dir: "asc" },
    searchable: true,
    rowActions: [
      {
        kind: "writeHandler",
        id: "delete",
        label: i18nKey("kumiko.actions.delete"),
        handler: "documents:write:document:delete",
        payload: { pick: ["id"] },
        confirm: i18nKey("kumiko.actions.delete-confirm"),
        style: "danger",
      },
    ],
    access,
    // The app places it with r.nav("documents:screen:list").
    dormant: true,
  };
}
