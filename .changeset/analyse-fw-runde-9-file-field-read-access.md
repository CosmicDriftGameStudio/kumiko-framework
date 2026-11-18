---
"@cosmicdrift/kumiko-framework": patch
"@cosmicdrift/kumiko-testing": patch
---

The file routes honour the read access of the field a file is attached to.

<!-- kumiko-changes
feature: framework
type: fix
title: A file in a read-restricted field stays closed to readers of the record without access to the field
detail: The default file guard let everyone who may read a record download its attached files, even when the field holding the file has an `access.read` rule the caller does not pass. When a file field of the entity (or one of its embedded file sub-fields) declares a read rule, the record's detail query must now return the file in one of its file fields for the caller; the query strips unreadable fields, so the same rule decides for the field and its file. The field that holds the file decides, also after a save moved it between the record's fields. This covers `GET /files/:id`, `/files/:id/meta`, `/files/meta`, `/files/:id/download-url`, `/files/:id/variant/:name` and `canCallerReadFileRef`. Uploaders and privileged roles keep their access; on a `record-only` entity type the field rule applies to privileged roles too. Files of fields without a read rule, uploads without a target field and custom `accessGuard`s behave as before. The cross-tenant file read asks only whether the declared query returns the record, so an entity with `crossTenantFileRead` and a file field (or embedded file sub-field) with an `access.read` rule now fails at boot (`files/cross-tenant-read-restricted-file-field`).
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Field read rules on read-model entities fail at boot instead of doing nothing
detail: An entity carried by a projection (`r.projection({ entity })`) accepted `access.read`, `writeOnly` and `access.read` on embedded sub-fields, but its queries are hand-written and the framework only strips fields of `r.entity` entities, so every reader of the row saw the field and the file guard released its files. Such a field now fails at boot (`projection/entity-field-read-rule`), on every entity a projection carries other than the `r.entity` of its own source (array source, a separate entity over an `r.entity` stream, a read model), also in `setupTestStack`; restrict the read model's query access instead or keep the field on an `r.entity`. The entity-level `access.read` of a read model is unchanged. `crossTenantFileRead` on a read-model entity, which the file routes already honour, is now validated at boot with the same rules as on an entity (reason, registered query, no read-restricted file field). On a projection entity the file routes never look up (array source, or a source stream that an `r.entity` of the app registers) it now fails at boot (`files/cross-tenant-read-unseen-projection-entity`) instead of being ignored. A field that a registrar extension adds through `extendSchema` with `access.read` or `writeOnly` now counts for the registry check too, so a query handler of that feature that is not bound to an entity must declare `resultEntity` or `unfilteredResult`, as for the entity's own fields.
-->
