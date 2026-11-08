---
"@cosmicdrift/kumiko-framework": minor
"@cosmicdrift/kumiko-types": minor
---

Entities take `crossTenantFileRead: { query, reason }`. Files attached to a record of such an entity can be read from another tenant (download, variant, download-url, meta, batch meta) when the named query handler, run with `{ id: <entityId> }` as the requesting user, returns the record with that id. Only that query decides; the file guard and its privileged roles do not apply, and delete stays with the owning tenant. Boot rejects an unregistered query or an empty reason.

<!-- kumiko-changes
feature: framework
type: improvement
title: Cross-tenant file reads declared per entity
detail: `crossTenantFileRead: { query, reason }` on an entity lets users of another tenant read its attached files when the named query handler, run as that user with `{ id: <entityId> }`, returns the record with that id. Covers GET /files/:id, /variant/:name, /download-url, /meta and GET /files/meta; variants are rendered and cached in the owning tenant. The query alone decides, so privilegedRoles and a custom accessGuard never open a foreign tenant's file. Anonymous users are always refused, delete and upload stay tenant-equal. Boot rules `files/cross-tenant-read-query-unregistered` and `files/cross-tenant-read-reason-missing`.
-->
