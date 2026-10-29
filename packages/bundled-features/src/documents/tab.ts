import type { EditRelatedListSection } from "@cosmicdrift/kumiko-framework/engine";
import type { DashboardStatPanel } from "@cosmicdrift/kumiko-framework/ui-types";
import { DOCUMENT_ENTITY, DOCUMENTS_FEATURE_NAME, DocumentsQueries } from "./constants.ts";
import { forTypeQueryQn } from "./queries/for-record.query.ts";

// "Documents" tab for the edit screen of a link target. The tab id is the same on every screen,
// so deep links like ?tab=documents work across hosts.
export function documentsTab(entityType: string): EditRelatedListSection {
  return {
    id: "documents",
    kind: "relatedList",
    title: "documents:tab.title",
    query: forTypeQueryQn(entityType),
    entity: `${DOCUMENTS_FEATURE_NAME}:${DOCUMENT_ENTITY}`,
    columns: [
      { field: "title", sortable: true },
      { field: "category", sortable: true },
      { field: "validUntil", sortable: true },
      { field: "file" },
    ],
    searchable: true,
    count: true,
  };
}

// Stat tiles for a dashboard: how many readable documents are expired or about to expire.
export function documentExpiryPanels(): readonly DashboardStatPanel[] {
  return [
    {
      kind: "stat",
      id: "documents-expired",
      label: "documents:overview.expired",
      query: DocumentsQueries.expiryOverview,
      valueField: "expired",
      tone: "negative",
    },
    {
      kind: "stat",
      id: "documents-expiring",
      label: "documents:overview.expiring",
      query: DocumentsQueries.expiryOverview,
      valueField: "expiring",
      tone: "warn",
    },
  ];
}
