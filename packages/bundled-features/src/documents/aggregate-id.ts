import { v5 as uuidv5 } from "uuid";

// Frozen: changing a namespace re-keys every derived stream and breaks replay.
const DOCUMENT_FOR_FILE_NAMESPACE = "6d2f7e41-3c58-4b0a-9e17-5a4c8d1b2f93";
const DOCUMENT_LINK_NAMESPACE = "b83a1c6e-9f20-4d57-a1e4-7c0d52f68b19";

// @wrapper-known uuid-domain
export function documentIdForFile(tenantId: string, fileRefId: string): string {
  return uuidv5(`${tenantId}|${fileRefId}`, DOCUMENT_FOR_FILE_NAMESPACE);
}

// @wrapper-known uuid-domain
export function documentLinkAggregateId(
  tenantId: string,
  documentId: string,
  entityType: string,
  entityId: string,
): string {
  return uuidv5(`${tenantId}|${documentId}|${entityType}|${entityId}`, DOCUMENT_LINK_NAMESPACE);
}
