import { v5 as uuidv5 } from "uuid";

// Fixed UUID namespace for document-ingest stream derivation. Frozen: changing
// it re-keys every existing ingest stream.
const DOCUMENT_INGEST_NAMESPACE = "5c1e8b7a-3d94-4f2a-b6e0-9a7d1c4f8e23";

// @wrapper-known uuid-domain
export function documentIngestAggregateId(tenantId: string, fileRefId: string): string {
  return uuidv5(`${tenantId}|${fileRefId}`, DOCUMENT_INGEST_NAMESPACE);
}
