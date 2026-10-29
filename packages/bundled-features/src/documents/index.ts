export { documentIdForFile, documentLinkAggregateId } from "./aggregate-id.ts";
export type { DocumentCaptureRule } from "./capture.ts";
export {
  DEFAULT_ADMIN_ROLES,
  DEFAULT_DOCUMENT_ACCESS,
  DOCUMENT_ENTITY,
  DOCUMENT_LINK_ENTITY,
  DOCUMENTS_FEATURE_NAME,
  DOCUMENTS_LIST_SCREEN_ID,
  DocumentsHandlers,
  DocumentsQueries,
  EXPIRY_STATES,
  type ExpiryState,
} from "./constants.ts";
export type { DocumentLinkReadMode } from "./entity.ts";
export {
  createDocumentsFeature,
  type DocumentsAccess,
  type DocumentsFeatureOptions,
} from "./feature.ts";
export { forTypeQueryQn } from "./queries/for-record.query.ts";
export { DOCUMENT_COLUMNS } from "./screens.ts";
export { documentExpiryPanels, documentsTab } from "./tab.ts";
