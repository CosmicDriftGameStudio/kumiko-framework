import type { AccessRule } from "@cosmicdrift/kumiko-framework/engine";

export const DOCUMENTS_FEATURE_NAME = "documents";

export const DOCUMENT_ENTITY = "document";
export const DOCUMENT_LINK_ENTITY = "document-link";

export const DEFAULT_DOCUMENT_ACCESS: AccessRule = { roles: ["TenantAdmin", "TenantMember"] };
export const DEFAULT_ADMIN_ROLES: readonly string[] = ["TenantAdmin", "SystemAdmin"];
export const DEFAULT_EXPIRING_WITHIN_DAYS = 30;

export const DOCUMENTS_LIST_SCREEN_ID = "list";

export const DocumentsHandlers = {
  link: "documents:write:link",
  unlink: "documents:write:unlink",
  import: "documents:write:import",
} as const;

export const DocumentsQueries = {
  list: "documents:query:document:list",
  detail: "documents:query:document:detail",
  forRecord: "documents:query:for-record",
  expiryOverview: "documents:query:expiry-overview",
  overview: "documents:query:overview",
} as const;

export const EXPIRY_STATES = ["expired", "expiring", "valid", "none"] as const;
export type ExpiryState = (typeof EXPIRY_STATES)[number];

export const EXPIRING_FACET_VALUE = "expiring";
