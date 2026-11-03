import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const DOCUMENTS_FEATURE_NAME = "documents";

export const DOCUMENT_ENTITY = "filed-document";
export const DOCUMENT_LINK_ENTITY = "filed-document-link";

export const DEFAULT_DOCUMENT_ACCESS: AccessRule = { roles: ["TenantAdmin", "TenantMember"] };
export const DEFAULT_ADMIN_ROLES: readonly string[] = ["TenantAdmin", "SystemAdmin"];
export const DEFAULT_EXPIRING_WITHIN_DAYS = 30;

export const DOCUMENTS_LIST_SCREEN_ID = "list";

export const DOCUMENT_LIVE_ENTITIES = [DOCUMENT_ENTITY, DOCUMENT_LINK_ENTITY];

export const DocumentsHandlers = {
  deleteDocument: `documents:write:${DOCUMENT_ENTITY}:delete`,
  link: "documents:write:link",
  unlink: "documents:write:unlink",
  import: "documents:write:import",
} as const;

export const DocumentsQueries = {
  list: `documents:query:${DOCUMENT_ENTITY}:list`,
  detail: `documents:query:${DOCUMENT_ENTITY}:detail`,
  linkList: `documents:query:${DOCUMENT_LINK_ENTITY}:list`,
  forRecord: "documents:query:for-record",
  expiryOverview: "documents:query:expiry-overview",
  overview: "documents:query:overview",
} as const;

export const EXPIRY_STATES = ["expired", "expiring", "valid", "none"] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

export const EXPIRING_FACET_VALUE = "expiring";
