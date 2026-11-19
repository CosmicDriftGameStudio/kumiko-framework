---
"@cosmicdrift/kumiko-bundled-features": patch
---

Document links, folder and tag assignments and document extracts gained lookup indexes that apps must ship as a migration.

<!-- kumiko-changes
feature: documents
type: improvement
title: Indexes on document links, folder and tag assignments and document extracts
detail: The document read gate checks every document row for a live link by `documentId`, and the record views look links and assignments up by `(entityType, entityId)`; these columns had no index (only `read_folder_assignments` already had `(tenantId, folderId)`), so each lookup scanned the tenant's rows. Added `(tenantId, documentId)` and `(tenantId, entityType, entityId)` on `read_filed_document_links`, `(tenantId, entityType, entityId)` on `read_folder_assignments`, `(tenantId, entityType, entityId)` and `(tenantId, tagId)` on `read_tag_assignments`, and `(tenantId, fileRefId)` on `read_document_extracts`. The schema drift check at boot does not flag missing indexes; apps that mount documents, folders, tags or document-ingest-foundation run `kumiko schema generate` and ship the resulting migration.
migration: Apps that mount documents, folders, tags or document-ingest-foundation run `kumiko-schema generate` and ship the resulting migration.
-->
