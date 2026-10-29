---
"@cosmicdrift/kumiko-bundled-features": minor
"@cosmicdrift/kumiko-types": minor
"@cosmicdrift/kumiko-framework": minor
---

New `documents` bundled feature and an entity `readGate` so a record can be visible only through links to other records and the owner of its file.

<!-- kumiko-changes
feature: framework
type: improvement
title: Entity readGate and the documents feature
detail: `createEntity({ readGate: { anyLink, fileOwner, linkExemptRoles } })` hides a row unless the viewer can read at least one linked host (join rows with a parentRef) and the owner of the referenced file; it is applied in list, detail, eager-load and relation reads, fail-closed without the registry, and the framework system user passes. Hand-written list/detail handlers for a gated entity are rejected at boot, live signals for gated entities stay anonymous. `ParentVisibilityOption` gains `canReadEntity` and `resolveTable`. The new `documents` feature (`createDocumentsFeature({ categories, linkTargets, capture?, retention? })`) files documents with category, issue and expiry date, links them to records (link, unlink, for-record and per-type queries, expiry overview), lists them on the `documents:screen:list` projection list through `documents:query:overview` (an `expiry` state per row and an "expiring" filter that returns expired and soon-expiring documents), captures files saved into configured entity fields via a postSave hook, and offers an idempotent SYSTEM-only import for jobs. Updating or deleting a document needs write access to one of its linked hosts (admin roles and the system user are exempt). Reference search and sort on a readGate target now apply the gate, and `parentVisibilityFor` decides `canReadEntity` by the entity's own detail query, the same rule the file route uses, so a `liveEntities` query no longer widens what a file owner shows. A document cannot claim another user's unbound upload. A document never defaults its title to the file name.
-->

<!-- kumiko-changes
feature: framework
type: fix
title: Hooks run for handlers that return response data; readOnly related lists
detail: A write handler wrapped by `withResponseData` (for example `tenant:write:remove-member`) lost its lifecycle result, so postSave/postDelete hooks and projections were skipped. `WriteResult` now carries an optional `lifecycle` that the dispatcher and batch flush use and that is stripped from client responses. `EditRelatedListSection` gains `readOnly: true` for plain tables without an entity; the boot validator rejects it together with rowClick/rowActions and guard R2 skips it. The bin test helpers and `envWithoutGitOverrides` now also strip GIT_COMMON_DIR and the other git location variables.
-->

<!-- kumiko-changes
feature: framework
type: breaking
title: An untouched money field is no longer submitted as 0
detail: Forms seed a money field with its currency only and drop that currency-only value on submit, so a handler can tell a deliberately typed 0 from an untouched field. A currency-only value counts as missing for required checks, and the input shows empty instead of 0.00; config forms keep their plain-number contract.
migration: A form that left a required money field untouched used to submit 0 and now fails validation; type the amount (also in e2e and DOM tests) or give the field a value through `load` or the record. Handlers that read an absent optional money field as 0 must default it themselves.
-->
