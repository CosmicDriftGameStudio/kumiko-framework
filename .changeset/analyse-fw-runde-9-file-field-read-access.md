---
"@cosmicdrift/kumiko-framework": patch
---

The file routes honour the read access of the field a file is attached to.

<!-- kumiko-changes
feature: framework
type: fix
title: A file in a read-restricted field stays closed to readers of the record without access to the field
detail: The default file guard let everyone who may read a record download its attached files, even when the field holding the file has an `access.read` rule the caller does not pass. When a file field of the entity (or one of its embedded file sub-fields) declares a read rule, the record's detail query must now return the file in one of its file fields for the caller; the query strips unreadable fields, so the same rule decides for the field and its file. The field that holds the file decides, also after a save moved it between the record's fields. This covers `GET /files/:id`, `/files/:id/meta`, `/files/meta`, `/files/:id/download-url`, `/files/:id/variant/:name` and `canCallerReadFileRef`. Uploaders and privileged roles keep their access; on a `record-only` entity type the field rule applies to privileged roles too. Files of fields without a read rule, uploads without a target field and custom `accessGuard`s behave as before. The cross-tenant file read asks only whether the declared query returns the record, so an entity with `crossTenantFileRead` and a file field (or embedded file sub-field) with an `access.read` rule now fails at boot (`files/cross-tenant-read-restricted-file-field`).
-->
