import {
  type AccessRule,
  i18nKey,
  type ProjectionListScreenDefinition,
} from "@cosmicdrift/kumiko-framework/engine";
import { DOCUMENTS_LIST_SCREEN_ID, DocumentsQueries, EXPIRING_FACET_VALUE } from "./constants.ts";

// The columns every document list shows; the tab and the standalone screen stay alike.
export const DOCUMENT_COLUMNS = ["title", "category", "validUntil", "file"] as const;

const FIELD_PREFIX = "documents:entity:document:field:";
const CATEGORY_OPTION_PREFIX = `${FIELD_PREFIX}category:option:`;

// A projectionList, not an entityList: the expiry state and its "expiring" filter are computed
// per request from a moving date window, which an entityList's facets on stored fields cannot
// express. The overview query still reads through the document list, so the read gate holds.
export function createDocumentListScreen(
  access: AccessRule,
  categories: readonly string[],
): ProjectionListScreenDefinition {
  return {
    id: DOCUMENTS_LIST_SCREEN_ID,
    type: "projectionList",
    query: DocumentsQueries.overview,
    columns: [
      { field: "title", label: `${FIELD_PREFIX}title` },
      {
        field: "category",
        label: `${FIELD_PREFIX}category`,
        renderer: { format: "enumOption", keyPrefix: CATEGORY_OPTION_PREFIX },
      },
      {
        field: "validUntil",
        label: `${FIELD_PREFIX}validUntil`,
        renderer: { format: "date", dateStyle: "medium" },
      },
      {
        field: "expiry",
        label: "documents:list.facet.expiry",
        sortable: false,
        hideOnNarrow: true,
        renderer: { format: "enumOption", keyPrefix: "documents:list.expiry." },
      },
      {
        field: "file",
        label: `${FIELD_PREFIX}file`,
        sortable: false,
        renderer: { format: "file" },
      },
    ],
    pagination: "pages",
    defaultSort: { field: "validUntil", dir: "asc" },
    searchable: true,
    facets: [
      {
        field: "category",
        type: "select",
        label: `${FIELD_PREFIX}category`,
        options: categories.map((value) => ({
          value,
          label: `${CATEGORY_OPTION_PREFIX}${value}`,
        })),
      },
      {
        field: "expiry",
        type: "select",
        label: "documents:list.facet.expiry",
        options: [{ value: EXPIRING_FACET_VALUE, label: "documents:list.facet.expiring" }],
      },
    ],
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
