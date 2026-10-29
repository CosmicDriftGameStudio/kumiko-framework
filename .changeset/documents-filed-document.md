---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-locale-de": patch
"@cosmicdrift/kumiko-locale-es": patch
"@cosmicdrift/kumiko-locale-fr": patch
"@cosmicdrift/kumiko-locale-it": patch
---

documents: the entities are named `filed-document` and `filed-document-link`, the import refuses a foreign id, and access splits into read, write and delete.

<!-- kumiko-changes
feature: framework
type: improvement
title: documents entities are filed-document and filed-document-link; safe import; split access
detail: The documents feature registers its entities as `filed-document` (table `read_filed_documents`) and `filed-document-link` (table `read_filed_document_links`), so an app that has its own `document` entity keeps its events and tables; handler and query names follow (`documents:write:filed-document:create`, `documents:query:filed-document:list`, `documents:query:filed-document-link:list`), and so do the field label keys `documents:entity:filed-document:field:*`. `documents:write:import` now fails with a conflict (`documents.errors.import-id-taken`) and links nothing when the id is already used by a stream that is not a document; a repeat import of the same document, deleted or not, still changes nothing; the check reads the stream, so a row-level `readAccess` cannot turn a retry into a refusal. With `readAccess` set, the system user keeps reading every document, so capture and import still find the ones the rule hides. An imported document's createdAt is the time of the import, because the event store does not backdate events; issuedAt carries the business date. `createDocumentsFeature({ access })` takes either one rule for everything, as before, or `{ read, write, delete }` (type `DocumentsAccess`): read covers the lists, detail, for-record, the overviews and the list screen, write covers create, update, link and unlink; a missing read or write keeps the TenantAdmin and TenantMember default and a missing delete follows write. The readGate on the document is unchanged.
-->
